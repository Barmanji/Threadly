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
    throw new ApiError(400, "User is not a part of this chat");
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
            // like docx/pptx), while PDFs should stay as image assets so they
            // get proper delivery/transform support.
            const resourceType: "auto" | "image" | "video" | "raw" =
              attachment.mimetype.startsWith("image/")
                ? "image"
                : attachment.mimetype.startsWith("video/")
                ? "video"
                : attachment.mimetype === "application/pdf"
                ? "image"
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
            console.error(`Upload failed for ${attachment.path}:`, error);
            throw error;
          }
        },
      );

      // Wait for all uploads to complete
      const uploadedFiles: any = await Promise.all(uploadPromises);
      messageFiles.push(...uploadedFiles);

      console.log(`Successfully uploaded ${messageFiles.length} files`);
    }

    // Create a new message instance with appropriate metadata
    const message = await ChatMessage.create({
      sender: new mongoose.Types.ObjectId((req.user as any)._id),
      content: content || "",
      chat: new mongoose.Types.ObjectId(chatId),
      attachments: messageFiles,
    });
    console.log("Message created with ID:", message._id);

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
    console.log("Chat updated, fetching structured message...");
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
    console.log("Structured message:", receivedMessage ? "EXISTS" : "NULL");

    if (!receivedMessage) {
      throw new ApiError(500, "Internal server error");
    }
    console.log("=== ABOUT TO EMIT SOCKET EVENTS ===");
    console.log("Chat participants:", chat.participants);

    // logic to emit socket event about the new message created to the other participants
    chat.participants.forEach((participantObjectId: ObjectId) => {
      console.log("Processing participant:", participantObjectId.toString());

      if (participantObjectId.toString() === (req.user as any)._id.toString()) {
        console.log("Skipping sender (self)");
        return;
      }

      console.log(
        "Emitting to participant room:",
        participantObjectId.toString(),
      );
      console.log("Event name:", ChatEventEnum.MESSAGE_RECEIVED_EVENT);

      emitSocketEvent(
        req,
        participantObjectId.toString(),
        ChatEventEnum.MESSAGE_RECEIVED_EVENT,
        receivedMessage,
      );

      console.log(
        "Emission completed for participant:",
        participantObjectId.toString(),
      );
    });

    console.log("=== ALL SOCKET EMISSIONS COMPLETED ===");

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
  console.log(
    "[download-attachment] cloudinary",
    response.status,
    response.headers.get("content-type"),
    "len=" + response.headers.get("content-length"),
    url,
  );
  if (!response.ok) {
    throw new ApiError(502, "Could not fetch the file from storage");
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

export { getAllMessages, sendMessage, deleteMessage, downloadAttachment };
