import mongoose, { ObjectId } from "mongoose";
import { Readable } from "stream";
import { ChatEventEnum } from "../constants.js";
import { Chat } from "../models/chat/chat.model.js";
import { ChatMessage } from "../models/chat/message.model.js";
import { emitSocketEvent } from "../socket/socket.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { removeLocalFile } from "../utils/helper.js";
import logger from "../logger/winston.logger.js";
import { Request, RequestHandler, Response } from "express";
import { uploadResultCloudinary } from "../utils/fileUploaderCloudinary.js";

interface AttachmentFile {
  url: string;
  localPath: string;
  mimetype: string;
  fileName: string;
  size: number;
}

type MulterRequest = Request & {
  files?: {
    [fieldname: string]: Express.Multer.File[];
  };
};
/**
 * @description Utility function which returns the pipeline stages to structure the chat message schema with common lookups
 * @returns {mongoose.PipelineStage[]}
 */
const chatMessageCommonAggregation = () => {
  return [
    {
      $lookup: {
        from: "users",
        foreignField: "_id",
        localField: "sender",
        as: "sender",
        pipeline: [
          {
            $project: {
              _id: 1,
              username: 1,
              avatar: 1,
              email: 1,
            },
          },
        ],
      },
    },
    {
      $addFields: {
        sender: { $first: "$sender" },
      },
    },
    // Resolve the reactor on each reaction so the client can render avatars
    // and "who reacted" without a second round trip. Only the fields the UI
    // needs are projected — an email address has no business riding along
    // inside a reaction chip.
    //
    // The original array has to be stashed first: a `$lookup` on an array
    // `localField` *replaces* it with the resolved users, dropping the emoji
    // that was stored alongside each id.
    {
      $set: { storedReactions: { $ifNull: ["$reactions", []] } },
    },
    {
      $lookup: {
        from: "users",
        foreignField: "_id",
        localField: "storedReactions.user",
        as: "resolvedReactors",
        pipeline: [
          { $project: { _id: 1, username: 1, avatar: 1 } },
        ],
      },
    },
    {
      $set: {
        reactions: {
          $map: {
            input: "$storedReactions",
            as: "reaction",
            in: {
              $mergeObjects: [
                "$$reaction",
                // Pair by id, not by position. `$lookup` silently omits users
                // that no longer exist, so positional pairing would shift
                // every subsequent emoji onto the wrong person. `$first` of
                // an empty match is null and `$mergeObjects` ignores it, so a
                // reaction from a deleted user keeps just its raw id.
                {
                  $first: {
                    $filter: {
                      input: { $ifNull: ["$resolvedReactors", []] },
                      as: "reactor",
                      cond: { $eq: ["$$reactor._id", "$$reaction.user"] },
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    // Drop the scratch fields so they never reach the client.
    { $unset: ["storedReactions", "resolvedReactors"] },
  ];
};

const getAllMessages: RequestHandler = asyncHandler(async (req, res) => {
  const { chatId } = req.params;

  const selectedChat = await Chat.findById(chatId);

  if (!selectedChat) {
    throw new ApiError(404, "Chat does not exist");
  }

  // Only send messages if the logged in user is a part of the chat he is requesting messages of
  if (!selectedChat.participants?.includes((req.user as any)._id)) {
    throw new ApiError(
      403,
      "You are not a member of this chat, so you can't read its messages.",
    );
  }

  const messages = await ChatMessage.aggregate([
    {
      $match: {
        chat: new mongoose.Types.ObjectId(chatId as string),
      },
    },
    ...chatMessageCommonAggregation(),
    {
      $sort: {
        createdAt: -1,
      },
    },
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse(200, messages || [], "Messages fetched successfully"),
    );
});

const sendMessage: RequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const multerReq = req as MulterRequest;
    const { chatId } = req.params;
    const { content } = req.body;
    if (!chatId || typeof chatId !== "string") {
      throw new ApiError(400, "Invalid Chat ID");
    }
    const files = multerReq.files;
    if (!content && !multerReq.files?.attachments?.length) {
      throw new ApiError(400, "Message content or attachment is required");
    }

    const selectedChat = await Chat.findById(chatId);

    if (!selectedChat) {
      throw new ApiError(404, "Chat does not exist");
    }

    const messageFiles: AttachmentFile[] = [];

    if (files && files.attachments && files.attachments.length > 0) {
      console.log(`Processing ${files.attachments.length} attachments...`);

      const uploadPromises = files.attachments.map(
        async (attachment: Express.Multer.File) => {
          try {
            // Pick an explicit Cloudinary resource type. Office documents must be
            // stored as "raw" (auto-detection is flaky for zip-based formats
            // like docx/pptx). PDFs are NOT sent as "image" — the image
            // resource type has a 20MB limit on free tier, which rejects
            // larger PDFs on production. "raw" supports up to 100MB.
            const resourceType: "auto" | "image" | "video" | "raw" =
              attachment.mimetype.startsWith("image/")
                ? "image"
                : attachment.mimetype.startsWith("video/")
                ? "video"
                : "raw";
            const uploadResult = await uploadResultCloudinary(
              attachment.path,
              resourceType,
            );
            if (!uploadResult) {
              throw new ApiError(
                400,
                `Failed to upload attachment: ${attachment.originalname}`,
              );
            }
            return {
              url: uploadResult.url,
              localPath: attachment.path,
              mimetype: attachment.mimetype,
              fileName: attachment.originalname,
              size: attachment.size,
            };
          } catch (error) {
            logger.error(
              `Failed to upload attachment ${attachment.path}: ${
                error instanceof Error ? error.message : "unknown error"
              }`,
            );
            throw error;
          }
        },
      );

      // Wait for all uploads to complete
      const uploadedFiles: any = await Promise.all(uploadPromises);
      messageFiles.push(...uploadedFiles);
    }

    // Create a new message instance with appropriate metadata
    const message = await ChatMessage.create({
      sender: new mongoose.Types.ObjectId((req.user as any)._id),
      content: content || "",
      chat: new mongoose.Types.ObjectId(chatId),
      attachments: messageFiles,
    });
    // update the chat's last message which could be utilized to show last message in the list item
    const chat = await Chat.findByIdAndUpdate(
      chatId,
      {
        $set: {
          lastMessage: message._id,
        },
      },
      { new: true },
    );
    // structure the message
    const messages = await ChatMessage.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(message._id),
        },
      },
      ...chatMessageCommonAggregation(),
    ]);

    // Store the aggregation result
    const receivedMessage = messages[0];

    if (!receivedMessage) {
      throw new ApiError(500, "Internal server error");
    }

    // logic to emit socket event about the new message created to the other participants
    chat.participants.forEach((participantObjectId: ObjectId) => {
      // The sender already has this message optimistically in their UI.
      if (participantObjectId.toString() === (req.user as any)._id.toString()) {
        return;
      }

      emitSocketEvent(
        req,
        participantObjectId.toString(),
        ChatEventEnum.MESSAGE_RECEIVED_EVENT,
        receivedMessage,
      );
    });

    return res
      .status(201)
      .json(
        new ApiResponse(201, receivedMessage, "Message saved successfully"),
      );
  },
);

const downloadAttachment: RequestHandler = asyncHandler(async (req, res) => {
  const url = req.query.url as string | undefined;
  const filename = (req.query.filename as string | undefined) || "download";
  if (!url) {
    throw new ApiError(400, "File URL is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError(400, "Invalid file URL");
  }

  // Only allow proxying our own object storage to avoid SSRF.
  if (!parsed.hostname.endsWith("res.cloudinary.com")) {
    throw new ApiError(400, "Only Cloudinary URLs are allowed");
  }

  // Fetch with browser-like headers — Cloudinary's CDN returns a short error
  // page (instead of the real file) for servers/clients that send a bare
  // user-agent, which is why blob downloads came back as tiny 2KB files.
  const response = await fetch(url, {
    headers: {
      Accept: "*/*",
      "User-Agent": "Mozilla/5.0 (compatible; ChatApp/1.0)",
    },
  });
  if (!response.ok) {
    throw new ApiError(
      502,
      "Could not fetch the file from storage. Please try downloading it again.",
    );
  }

  const safeName = filename.replace(/[^\w.-]+/g, "_") || "download";

  res.setHeader(
    "Content-Type",
    response.headers.get("content-type") || "application/octet-stream",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    res.setHeader("Content-Length", contentLength);
  }

  if (response.body) {
    // Stream the file through instead of buffering the whole thing in memory.
    Readable.fromWeb(response.body as never).pipe(res);
  } else {
    res.end();
  }
});

const deleteMessage: RequestHandler = asyncHandler(async (req, res) => {
  const { chatId, messageId } = req.params;

  if (!chatId || typeof chatId !== "string") {
    throw new ApiError(400, "Invalid Chat ID");
  }
  //Find the chat based on chatId and checking if user is a participant of the chat
  const chat = await Chat.findOne({
    _id: new mongoose.Types.ObjectId(chatId),
    participants: (req.user as any)._id,
  });

  if (!chat) {
    throw new ApiError(404, "Chat does not exist");
  }

  //Find the message based on message id
  if (!messageId || typeof messageId !== "string") {
    throw new ApiError(400, "Invalid Chat ID");
  }
  const message = await ChatMessage.findOne({
    _id: new mongoose.Types.ObjectId(messageId),
  });

  if (!message) {
    throw new ApiError(404, "Message does not exist");
  }

  // Check if user is the sender of the message
  if (message.sender.toString() !== (req.user as any)._id.toString()) {
    throw new ApiError(
      403,
      "You are not the authorised to delete the message, you are not the sender",
    );
  }
  if (message.attachments.length > 0) {
    //If the message is attachment  remove the attachments from the server
    message.attachments.map((asset: any) => {
      removeLocalFile(asset.localPath);
    });
  }
  //deleting the message from DB
  await ChatMessage.deleteOne({
    _id: new mongoose.Types.ObjectId(messageId),
  });

  //Updating the last message of the chat to the previous message after deletion if the message deleted was last message
  if (chat.lastMessage.toString() === message._id.toString()) {
    const lastMessage = await ChatMessage.findOne(
      { chat: chatId },
      {},
      { sort: { createdAt: -1 } },
    );

    await Chat.findByIdAndUpdate(chatId, {
      lastMessage: lastMessage ? lastMessage?._id : null,
    });
  }
  // logic to emit socket event about the message deleted  to the other participants
  chat.participants.forEach((participantObjectId: ObjectId) => {
    // here the chat is the raw instance of the chat in which participants is the array of object ids of users
    // avoid emitting event to the user who is deleting the message
    if (participantObjectId.toString() === (req.user as any)._id.toString())
      return;
    // emit the delete message event to the other participants frontend with delete messageId as the payload
    emitSocketEvent(
      req,
      participantObjectId.toString(),
      ChatEventEnum.MESSAGE_DELETE_EVENT,
      message,
    );
  });

  return res
    .status(200)
    .json(new ApiResponse(200, message, "Message deleted successfully"));
});

/** The emojis offered in the reaction picker, in display order. */
const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥"] as const;

const reactToMessage: RequestHandler = asyncHandler(async (req, res) => {
  // Express types path params as `string | string[]`; the route only ever
  // matches a single segment, so narrow once and reuse.
  const chatId = String(req.params.chatId ?? "");
  const messageId = String(req.params.messageId ?? "");
  const emoji = (req.body?.emoji || "").toString().trim();
  const userId = (req.user as any)._id;

  if (!mongoose.isValidObjectId(chatId)) {
    throw new ApiError(400, "That chat link is invalid.");
  }
  if (!mongoose.isValidObjectId(messageId)) {
    throw new ApiError(400, "That message link is invalid.");
  }

  // A shortlist rather than an open door. Accepting arbitrary strings lets a
  // client store megabytes of text in a field the UI renders as a chip, and
  // lets someone push content that is not an emoji at all.
  if (!(ALLOWED_REACTIONS as readonly string[]).includes(emoji)) {
    throw new ApiError(
      400,
      "Pick one of the available reactions.",
      [{ path: "emoji", message: "That reaction isn't available." }],
    );
  }

  const chat = await Chat.findOne({
    _id: new mongoose.Types.ObjectId(chatId),
    participants: userId,
  });
  if (!chat) {
    throw new ApiError(
      403,
      "You are not a member of this chat, so you can't react to its messages.",
    );
  }

  const message = await ChatMessage.findOne({
    _id: new mongoose.Types.ObjectId(messageId),
    chat: new mongoose.Types.ObjectId(chatId),
  });
  if (!message) {
    throw new ApiError(404, "That message no longer exists.");
  }

  // Toggle semantics, matching what people expect from WhatsApp:
  //   same user, same emoji  -> remove the reaction
  //   same user, new emoji   -> replace it
  //   different user         -> add a new one (stacks in a group)
  // The untyped model gives `any` here, so the callback params are declared
  // to keep this file under `noImplicitAny`.
  const isMine = (r: { user: unknown; emoji: string }) =>
    String(r.user) === userId.toString();

  const existing = (message.reactions as Array<{ user: unknown; emoji: string }>).find(isMine);
  const isRemoving = existing?.emoji === emoji;

  // In both branches this user's previous entry goes; the only difference is
  // whether a new one is appended.
  message.reactions = (message.reactions as Array<{ user: unknown }>).filter(
    (r) => !isMine(r as { user: unknown; emoji: string }),
  );
  if (!isRemoving) {
    message.reactions.push({
      user: new mongoose.Types.ObjectId(userId),
      emoji,
    });
  }
  await message.save({ validateBeforeSave: false });

  // Re-run the aggregation so the socket payload and the HTTP response have
  // the same populated shape the initial message fetch produces. Without this
  // the client receives raw ObjectIds and loses avatars on every update.
  const [structured] = await ChatMessage.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(messageId) } },
    ...chatMessageCommonAggregation(),
  ]);

  chat.participants.forEach((participantObjectId: ObjectId) => {
    if (participantObjectId.toString() === userId.toString()) return;
    emitSocketEvent(
      req,
      participantObjectId.toString(),
      ChatEventEnum.MESSAGE_REACTION_EVENT,
      {
        messageId: structured._id,
        chatId: structured.chat,
        reactions: structured.reactions,
        // Who reacted last, so the client can attribute a "X reacted" hint
        // without diffing the whole array.
        updatedBy: structured.sender,
      },
    );
  });

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        messageId: structured._id,
        reactions: structured.reactions,
        // Lets the originating client update its own bubble immediately
        // rather than waiting for its own socket echo.
        myReaction: isRemoving ? null : emoji,
      },
      isRemoving ? "Reaction removed" : "Reaction added",
    ),
  );
});

export {
  getAllMessages,
  sendMessage,
  deleteMessage,
  downloadAttachment,
  reactToMessage,
};
