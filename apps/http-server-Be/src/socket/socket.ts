import cookie from "cookie";
import jwt from "jsonwebtoken";
import { Server, Socket } from "socket.io";
import { ChatEventEnum } from "../constants.js";
import { User, IUser } from "../models/user/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import type { Request } from "express";

type AvailableChatEvents = (typeof ChatEventEnum)[keyof typeof ChatEventEnum];

type SocketWithUser = Socket & { user?: Pick<IUser, "_id"> & Partial<IUser> };

/**
 * Tracks active 1:1 calls (userId -> peerUserId, both directions) so we can
 * reliably notify the peer when one side drops the call — even if the client's
 * "call-ended" event is lost (tab close, reload, network blip).
 */
const activeCalls = new Map<string, string>();

const registerCall = (a: string, b: string): void => {
  if (!a || !b) return;
  activeCalls.set(a, b);
  activeCalls.set(b, a);
};

const deregisterCall = (a: string, b: string): void => {
  if (activeCalls.get(a) === b) activeCalls.delete(a);
  if (activeCalls.get(b) === a) activeCalls.delete(b);
};

const deregisterUserCalls = (userId: string): string[] => {
  const peers: string[] = [];
  const peerId = activeCalls.get(userId);
  if (peerId) {
    peers.push(peerId);
    deregisterCall(userId, peerId);
  }
  return peers;
};

const mountJoinChatEvent = (socket: Socket): void => {
  socket.on(ChatEventEnum.JOIN_CHAT_EVENT, (chatId: string) => {
    const userId = (socket as any).user?._id?.toString();
    console.log("[joinChat] user:", userId, "chatId:", chatId);
    // joining the room with the chatId will allow specific events to be fired where we don't bother about the users like typing events
    // E.g. When user types we don't want to emit that event to specific participant.
    // We want to just emit that to the chat where the typing is happening
    socket.join(chatId);
  });
};

/*
 * This function is responsible to emit the typing event to the other participants of the chat
 */
const mountParticipantTypingEvent = (socket: Socket): void => {
  socket.on(ChatEventEnum.TYPING_EVENT, (payload) => {
    const chatId = typeof payload === "string" ? payload : payload?.chatId;
    if (!chatId) return;
    socket.in(chatId).emit(ChatEventEnum.TYPING_EVENT, payload);
  });
};

/**
 * This function is responsible to emit the stopped typing event to the other participants of the chat
 */
const mountParticipantStoppedTypingEvent = (socket: Socket): void => {
  socket.on(ChatEventEnum.STOP_TYPING_EVENT, (payload) => {
    const chatId = typeof payload === "string" ? payload : payload?.chatId;
    if (!chatId) return;
    socket.in(chatId).emit(ChatEventEnum.STOP_TYPING_EVENT, payload);
  });
};

const mountWhiteboardUpdateEvent = (socket: Socket): void => {
  socket.on(
    ChatEventEnum.WHITEBOARD_UPDATE_EVENT,
    (data: { chatId: string; elements: any[]; appState: any }) => {
      const senderId = (socket as any).user?._id?.toString();
      console.log(
        "[whiteboard-update] sender:",
        senderId,
        "chatId:",
        data.chatId,
        "elements:",
        data.elements?.length,
      );
      socket.in(data.chatId).emit("whiteboardUpdate", {
        elements: data.elements,
        appState: data.appState,
      });
    },
  );
};

const mountWhiteboardStrokeEvent = (socket: Socket): void => {
  socket.on(
    ChatEventEnum.WHITEBOARD_STROKE_EVENT,
    (data: { chatId: string; stroke: any }) => {
      const senderId = (socket as any).user?._id?.toString();
      console.log(
        "[whiteboard-stroke] sender:",
        senderId,
        "chatId:",
        data.chatId,
      );
      socket.in(data.chatId).emit("whiteboardStroke", {
        stroke: data.stroke,
      });
    },
  );
};

const mountWhiteboardClearEvent = (socket: Socket): void => {
  socket.on(ChatEventEnum.WHITEBOARD_CLEAR_EVENT, (chatId: string) => {
    socket.in(chatId).emit(ChatEventEnum.WHITEBOARD_CLEAR_EVENT, chatId);
  });
};

const mountWhiteboardOpenEvent = (socket: Socket): void => {
  socket.on(ChatEventEnum.WHITEBOARD_OPEN_EVENT, (chatId: string) => {
    socket.in(chatId).emit(ChatEventEnum.WHITEBOARD_OPEN_EVENT, chatId);
  });
};

const mountWhiteboardOpenCancelEvent = (socket: Socket): void => {
  socket.on(ChatEventEnum.WHITEBOARD_OPEN_CANCEL_EVENT, (chatId: string) => {
    socket.in(chatId).emit(ChatEventEnum.WHITEBOARD_OPEN_CANCEL_EVENT, chatId);
  });
};

/**
 * Initialize socket server
 */
const initializeSocketIO = (io: Server) => {
  console.log("io: ", io);
  return io.on("connection", async (rawSocket: Socket) => {
    console.log("io2: ", io, "\n rawSoc: ", rawSocket);

    const socket = rawSocket as SocketWithUser;
    try {
      // parse the cookies from the handshake headers (This is only possible if client has `withCredentials: true`)

      const cookieHeader = socket.handshake.headers?.cookie;
      const cookies = cookie.parse(cookieHeader?.toString() || "");

      let token: string | undefined = cookies?.accessToken;
      if (!token) {
        // If there is no access token in cookies. Check inside the handshake auth
        token = (
          socket.handshake.auth as
            | Record<string, string | undefined>
            | undefined
        )?.token;
      }

      if (!token) {
        // Token is required for the socket to work
        throw new ApiError(401, "Un-authorized handshake. Token is missing");
      }
      const decodedToken = jwt.verify(
        token,
        process.env.ACCESS_TOKEN_SECRET as string,
      ) as { _id: string };

      const user = await User.findById(decodedToken?._id).select(
        "-password -refreshToken",
      );

      // retrieve the user
      if (!user) {
        throw new ApiError(401, "Un-authorized handshake. Token is invalid");
      }
      socket.user = user as unknown as SocketWithUser["user"]; // mount the user object to the socket

      // We are creating a room with user id so that if user is joined but does not have any active chat going on.
      // still we want to emit some socket events to the user.
      // so that the client can catch the event and show the notifications.
      socket.join(user._id!.toString());
      socket.emit(ChatEventEnum.CONNECTED_EVENT); // emit the connected event so that client is aware
      console.log("User connected 🗼. userId: ", user._id!.toString());

      // Common events that needs to be mounted on the initialization
      mountJoinChatEvent(socket);
      mountParticipantTypingEvent(socket);
      mountParticipantStoppedTypingEvent(socket);
      mountWhiteboardUpdateEvent(socket);
      mountWhiteboardStrokeEvent(socket);
      mountWhiteboardClearEvent(socket);
      mountWhiteboardOpenEvent(socket);
      mountWhiteboardOpenCancelEvent(socket);

      //p2p call events
      socket.on("call-user", (data) => {
        const { to, offer, callType, chatId } = data;
        const senderId = socket.user?._id?.toString();
        if (senderId) registerCall(senderId, to);
        socket.to(to).emit("incomming-call", {
          from: socket.user?._id,
          fromUser: {
            _id: socket.user?._id,
            username: socket.user?.username,
            avatar: socket.user?.avatar,
          },
          offer,
          callType,
          chatId,
        });
      });

      socket.on("call-accepted", (data) => {
        const { to, answer } = data;
        const senderId = socket.user?._id?.toString();
        if (senderId) registerCall(senderId, to);
        socket.to(to).emit("call-accepted", {
          from: socket.user?._id,
          answer,
        });
      });

      socket.on("call-rejected", (data) => {
        const { to } = data;
        const senderId = socket.user?._id?.toString();
        socket.to(to).emit("call-rejected", {
          from: socket.user?._id,
        });
        if (senderId) {
          deregisterCall(senderId, to);
        }
      });

      socket.on("peer-nego-needed", (data) => {
        const { to, offer } = data;
        socket.to(to).emit("peer-nego-needed", {
          from: socket.user?._id,
          offer,
        });
      });

      socket.on("peer-nego-done", (data) => {
        const { to, ans } = data;
        socket.to(to).emit("peer-nego-final", {
          from: socket.user?._id,
          ans,
        });
      });

      socket.on("ice-candidate", (data) => {
        const { to, candidate } = data;
        socket.to(to).emit("ice-candidate", {
          from: socket.user?._id,
          candidate,
        });
      });

      socket.on("call-ended", (data) => {
        const { to } = data;
        const senderId = socket.user?._id?.toString();
        console.log("[call-ended] emitted by:", senderId, "to:", to);
        socket.to(to).emit("call-ended", {
          from: socket.user?._id,
        });
        if (senderId) {
          deregisterCall(senderId, to);
        }
      });

      // Relay media state (mute/video-off) between P2P call peers
      socket.on("peer-media-state", (data: { to: string; audio?: boolean; video?: boolean }) => {
        socket.to(data.to).emit("peer-media-state", {
          from: socket.user?._id,
          audio: data.audio,
          video: data.video,
        });
      });

      // Group call events
      socket.on("group-call-invite", (data) => {
        const { roomId, callType, participants } = data;
        // Broadcast the invitation to the whole chat room so EVERY member gets
        // notified (per-user targeting can silently miss peers). The sender is
        // excluded automatically by `socket.to(...)`.
        socket.to(roomId).emit("group-call-invitation", {
          roomId,
          callType,
          from: socket.user?._id,
          fromUser: {
            _id: socket.user?._id,
            username: socket.user?.username,
            avatar: socket.user?.avatar,
          },
        });
        // Keep the targeted emit as a fallback for members who left the chat
        // room but are reachable via their own user id room.
        (participants as string[]).forEach((participantId: string) => {
          if (participantId === socket.user?._id?.toString()) return;
          socket.to(participantId).emit("group-call-invitation", {
            roomId,
            callType,
            from: socket.user?._id,
            fromUser: {
              _id: socket.user?._id,
              username: socket.user?.username,
              avatar: socket.user?.avatar,
            },
          });
        });
      });

      socket.on("group-call-accepted", (data) => {
        const { roomId } = data;
        socket.to(roomId).emit("group-call-participant-joined", {
          participantId: socket.user?._id,
        });
      });

      socket.on("group-call-rejected", (data) => {
        const { roomId } = data;
        socket.to(roomId).emit("group-call-participant-rejected", {
          participantId: socket.user?._id,
        });
      });

      socket.on("group-call-media-state", (data) => {
        const { roomId, video, audio } = data;
        if (!roomId) return;
        socket.to(roomId).emit("group-call-media-state-update", {
          peerId: socket.user?._id,
          video,
          audio,
        });
      });

      socket.on("group-call-ended", (data) => {
        const { roomId } = data;
        socket.to(roomId).emit("group-call-ended", {
          endedBy: socket.user?._id,
        });
      });

      // The initiator cancelled/left the call before (or even after) people
      // joined — dismiss any pending incoming-call popups and make everyone
      // who did join tear down their session so nobody is left in a void call.
      socket.on("group-call-cancelled", (data) => {
        const { roomId, participants } = data;
        if (!roomId) return;
        const payload = {
          roomId,
          cancelledBy: socket.user?._id,
          fromUser: {
            _id: socket.user?._id,
            username: socket.user?.username,
            avatar: socket.user?.avatar,
          },
        };
        socket.to(roomId).emit("group-call-cancelled", payload);
        // Mirror the invite: people who are NOT in the chat socket room
        // (e.g. they got the invite while on another page) must also be
        // reached via their own user-id room.
        (participants as string[]).forEach((participantId: string) => {
          if (participantId === socket.user?._id?.toString()) return;
          socket.to(participantId).emit("group-call-cancelled", payload);
        });
      });

      socket.on(ChatEventEnum.DISCONNECT_EVENT, () => {
        console.log("user has disconnected 🚫. userId: " + socket.user?._id);
        if (socket.user?._id) {
          const userId = socket.user._id.toString();
          // If the user was in an active call, forcefully notify the peer so
          // their UI doesn't get stuck on the call screen.
          const peers = deregisterUserCalls(userId);
          console.log(
            "[disconnect] user:",
            userId,
            "was in active call, notifying:",
            peers,
          );
          peers.forEach((peerId) => {
            io.to(peerId).emit("call-ended", { from: userId });
          });
          socket.leave(userId);
        }
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong while connecting to the socket.";
      socket.emit(ChatEventEnum.SOCKET_ERROR_EVENT, message);
    }
  });
};
const emitSocketEvent = (
  req: Request,
  roomId: string,
  event: AvailableChatEvents,
  payload: unknown,
): void => {
  console.log("emitSocketEvent called with:", {
    roomId,
    event,
    hasPayload: !!payload,
    hasIO: !!req.app.get("io"),
  });

  const io = req.app.get("io") as Server;

  if (!io) {
    console.error("NO IO INSTANCE FOUND ON REQ.APP");
    return;
  }

  io.in(roomId).emit(event, payload);
};

export { initializeSocketIO, emitSocketEvent };
