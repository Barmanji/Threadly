import cookie from "cookie";
import jwt from "jsonwebtoken";
import { Server, Socket } from "socket.io";
import { ChatEventEnum } from "../constants.js";
import { User, IUser } from "../models/user/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import type { Request } from "express";

type AvailableChatEvents = (typeof ChatEventEnum)[keyof typeof ChatEventEnum];

type SocketWithUser = Socket & { user?: Pick<IUser, "_id"> & Partial<IUser> };

const mountJoinChatEvent = (socket: Socket): void => {
  socket.on(ChatEventEnum.JOIN_CHAT_EVENT, (chatId: string) => {
    console.log(`User joined the chat 🤝. chatId: `, chatId);
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
  socket.on(ChatEventEnum.TYPING_EVENT, (chatId: string) => {
    socket.in(chatId).emit(ChatEventEnum.TYPING_EVENT, chatId);
  });
};

/**
 * This function is responsible to emit the stopped typing event to the other participants of the chat
 */
const mountParticipantStoppedTypingEvent = (socket: Socket): void => {
  socket.on(ChatEventEnum.STOP_TYPING_EVENT, (chatId: string) => {
    socket.in(chatId).emit(ChatEventEnum.STOP_TYPING_EVENT, chatId);
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

      //p2p call events
      socket.on("call-user", (data) => {
        const { to, offer } = data;
        socket.to(to).emit("incomming-call", {
          from: socket.user?._id,
          offer,
        });
      });

      socket.on("call-accepted", (data) => {
        const { to, answer } = data;
        socket.to(to).emit("call-accepted", {
          from: socket.user?._id,
          answer,
        });
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
        socket.to(to).emit("call-ended", {
          from: socket.user?._id,
        });
      });

      socket.on(ChatEventEnum.DISCONNECT_EVENT, () => {
        console.log("user has disconnected 🚫. userId: " + socket.user?._id);
        if (socket.user?._id) {
          socket.leave(socket.user._id.toString());
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
