import cookie from "cookie";
import jwt from "jsonwebtoken";
import * as Sentry from "@sentry/node";
import { Server, Socket } from "socket.io";
import { ChatEventEnum } from "../constants.js";
import { User, IUser } from "../models/user/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import {
  endGroupCall,
  endP2PCall,
  finalizeCallsForUser,
  markCallAnswered,
  markGroupCallJoined,
  markGroupCallLeft,
  startGroupCall,
  startP2PCall,
  type CallType,
} from "../services/callLog.service.js";
import logger from "../logger/winston.logger.js";
import { getChatMembers, isChatParticipant } from "./chatAccess.js";
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

/**
 * True only when the server has a registered 1:1 call between these two users.
 *
 * Every 1:1 signaling event after the initial `call-user` is authorized with
 * this, which means the only user who can relay call events to a victim is one
 * the victim is actually already in a call with. That closes the teardown and
 * harassment vector -- previously any socket could emit `call-ended` or
 * `call-user` at any user id and drop their call or ring them arbitrarily.
 *
 * It is also the cheapest correct check available: `activeCalls` is already
 * populated by `call-user`, so it is a map read with no database round trip.
 */
const isActiveCallPair = (a: string | undefined, b: unknown): boolean => {
  if (!a || typeof b !== "string" || !b) return false;
  return activeCalls.get(a) === b;
};

/**
 * Relay a 1:1 signaling event, but only within a call the server registered.
 * Synchronous, so no await is needed at the call site.
 */
const guardPeerCall = (
  socket: SocketWithUser,
  to: unknown,
  label: string,
  relay: () => void,
): void => {
  const senderId = socket.user?._id?.toString();
  if (!isActiveCallPair(senderId, to)) {
    logger.warn(
      `[socket] denied ${label}: user=${senderId} to=${String(to)} (no active call)`,
    );
    return;
  }
  relay();
};

/**
 * The body of `call-user`, split out so the authorization check can run first
 * and the rest can stay synchronous.
 */
const handleCallUser = (
  socket: SocketWithUser,
  data: { to: string; offer: unknown; callType: unknown; chatId: unknown },
  senderId: string | undefined,
): void => {
  const { to, offer, callType, chatId } = data;
  // If the callee is already on a 1:1 call with a DIFFERENT user,
  // tell the caller they're busy and don't relay the offer — otherwise
  // the callee's UI would stack a second incoming call on top of the
  // active one. Calls between the same two users (glare, both dialed
  // each other) are allowed through so the client can resolve them.
  const calleeBusyWith = to ? activeCalls.get(to) : null;
  if (calleeBusyWith && calleeBusyWith !== senderId) {
    logger.debug(
      `[call-user] ${senderId} -> ${to} is already on a call with ${calleeBusyWith}`,
    );
    socket.emit("call-busy", {
      to,
      busyWith: calleeBusyWith,
      fromUser: {
        _id: socket.user?._id,
        username: socket.user?.username,
        avatar: socket.user?.avatar,
      },
    });
    return;
  }
  if (senderId) registerCall(senderId, to);
  // Open a server-side call record. It is finalized when the call ends,
  // is declined, or either side disconnects — see callLog.service.ts.
  if (senderId) {
    startP2PCall({
      callerId: senderId,
      calleeId: to,
      chatId: chatId as string,
      callType: callType as CallType,
    });
  }
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
};

/**
 * Run `handler` only if the socket's user is a participant of `chatId`.
 *
 * Every room-scoped event goes through here. The membership check is async and
 * the handler is therefore async too; the void-ed promise is deliberate --
 * socket.io does not observe rejections from listeners, so an escaping throw
 * would become an unhandled rejection and take the process down. `relay` is
 * responsible for its own error handling.
 */
const guardRoom = (
  socket: SocketWithUser,
  chatId: unknown,
  label: string,
  relay: () => void,
): void => {
  void (async () => {
    const userId = socket.user?._id?.toString();
    if (!(await isChatParticipant(userId, chatId))) {
      logger.warn(
        `[socket] denied ${label}: user=${userId} chat=${String(chatId)}`,
      );
      return;
    }
    relay();
  })().catch((error: unknown) => {
    logger.error(
      `[socket] ${label} relay failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    /*
     * This catch is the only thing standing between a throwing socket handler and
     * an unhandled rejection that kills the process, so it is also the only place
     * the failure is visible at all. `logger.error` alone is not enough: winston's
     * level is `warn` in production, so the formatted string it writes has the
     * stack discarded and goes to a log file nobody tails.
     *
     * The `label` is included as a tag so every occurrence of one handler failing
     * groups into a single issue instead of one issue per call site.
     */
    Sentry.captureException(error, {
      tags: { subsystem: "socket", event: label },
      extra: { userId: socket.user?._id?.toString(), chatId: String(chatId) },
    });
  });
};

const mountJoinChatEvent = (socket: SocketWithUser): void => {
  socket.on(ChatEventEnum.JOIN_CHAT_EVENT, (chatId: string) => {
    const userId = socket.user?._id?.toString();
    // joining the room with the chatId will allow specific events to be fired where we don't bother about the users like typing events
    // E.g. When user types we don't want to emit that event to specific participant.
    // We want to just emit that to the chat where the typing is happening
    //
    // Membership is required. Without it any authenticated socket could join
    // any room by id, which is the entry point to everything below: a joined
    // socket receives that room's typing events and live whiteboard traffic.
    guardRoom(socket, chatId, "joinChat", () => {
      socket.join(chatId);
      logger.debug(`[joinChat] user: ${userId} chatId: ${chatId}`);
    });
  });
};

/*
 * This function is responsible to emit the typing event to the other participants of the chat
 */
const mountParticipantTypingEvent = (socket: SocketWithUser): void => {
  socket.on(ChatEventEnum.TYPING_EVENT, (payload) => {
    const chatId = typeof payload === "string" ? payload : payload?.chatId;
    if (!chatId) return;
    // `socket.in(...)` addresses the room directly and does NOT require the
    // sender to be in it, so without this check a socket that never passed
    // joinChat could still inject typing indicators into a chat it cannot see.
    guardRoom(socket, chatId, "typing", () => {
      socket.in(chatId).emit(ChatEventEnum.TYPING_EVENT, payload);
    });
  });
};

/**
 * This function is responsible to emit the stopped typing event to the other participants of the chat
 */
const mountParticipantStoppedTypingEvent = (socket: SocketWithUser): void => {
  socket.on(ChatEventEnum.STOP_TYPING_EVENT, (payload) => {
    const chatId = typeof payload === "string" ? payload : payload?.chatId;
    if (!chatId) return;
    guardRoom(socket, chatId, "stoppedTyping", () => {
      socket.in(chatId).emit(ChatEventEnum.STOP_TYPING_EVENT, payload);
    });
  });
};

const mountWhiteboardUpdateEvent = (socket: SocketWithUser): void => {
  socket.on(
    ChatEventEnum.WHITEBOARD_UPDATE_EVENT,
    (data: { chatId: string; elements: any[]; appState: any }) => {
      guardRoom(socket, data?.chatId, "whiteboardUpdate", () => {
        socket.in(data.chatId).emit("whiteboardUpdate", {
          elements: data.elements,
          appState: data.appState,
        });
      });
    },
  );
};

const mountWhiteboardStrokeEvent = (socket: SocketWithUser): void => {
  socket.on(
    ChatEventEnum.WHITEBOARD_STROKE_EVENT,
    (data: { chatId: string; stroke: any }) => {
      guardRoom(socket, data?.chatId, "whiteboardStroke", () => {
        socket.in(data.chatId).emit("whiteboardStroke", {
          stroke: data.stroke,
        });
      });
    },
  );
};

const mountWhiteboardClearEvent = (socket: SocketWithUser): void => {
  socket.on(ChatEventEnum.WHITEBOARD_CLEAR_EVENT, (chatId: string) => {
    guardRoom(socket, chatId, "whiteboardClear", () => {
      socket.in(chatId).emit(ChatEventEnum.WHITEBOARD_CLEAR_EVENT, chatId);
    });
  });
};

const mountWhiteboardOpenEvent = (socket: SocketWithUser): void => {
  socket.on(ChatEventEnum.WHITEBOARD_OPEN_EVENT, (chatId: string) => {
    guardRoom(socket, chatId, "whiteboardOpen", () => {
      socket.in(chatId).emit(ChatEventEnum.WHITEBOARD_OPEN_EVENT, chatId);
    });
  });
};

const mountWhiteboardOpenCancelEvent = (socket: SocketWithUser): void => {
  socket.on(ChatEventEnum.WHITEBOARD_OPEN_CANCEL_EVENT, (chatId: string) => {
    guardRoom(socket, chatId, "whiteboardOpenCancel", () => {
      socket.in(chatId).emit(ChatEventEnum.WHITEBOARD_OPEN_CANCEL_EVENT, chatId);
    });
  });
};

/**
 * Initialize socket server
 */
const initializeSocketIO = (io: Server) => {
  return io.on("connection", async (rawSocket: Socket) => {
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
        // Ringing an arbitrary user id is harassment, so the caller has to be in
        // the chat this call belongs to. The client always sends that chatId
        // (chat.tsx resolves callChatId from the chat it is calling out of, or
        // from the chatId the caller passed through signaling), and a 1:1 call
        // is only ever placed from inside a chat, so this cannot reject a
        // legitimate call. Denied callers get an explicit event rather than
        // silence: the client would otherwise sit on "connecting..." forever.
        void (async () => {
          if (!(await isChatParticipant(senderId, chatId))) {
            logger.warn(
              `[socket] denied call-user: user=${senderId} to=${to} chat=${String(chatId)}`,
            );
            socket.emit("call-denied", {
              to,
              reason: "You can only call someone from a chat you share.",
            });
            return;
          }
          handleCallUser(socket, { to, offer, callType, chatId }, senderId);
        })().catch((error: unknown) => {
          logger.error(
            `[socket] call-user failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        });
      });

      socket.on("call-accepted", (data) => {
        const { to, answer } = data;
        const senderId = socket.user?._id?.toString();
        guardPeerCall(socket, to, "call-accepted", () => {
          registerCall(senderId!, to);
          // Start the duration clock. Whoever accepted is the one who joined.
          markCallAnswered(senderId!, to);
          socket.to(to).emit("call-accepted", {
            from: socket.user?._id,
            answer,
          });
        });
      });

      socket.on("call-rejected", (data) => {
        const { to } = data;
        const senderId = socket.user?._id?.toString();
        guardPeerCall(socket, to, "call-rejected", () => {
          socket.to(to).emit("call-rejected", {
            from: socket.user?._id,
          });
          deregisterCall(senderId!, to);
          void endP2PCall({
            a: senderId!,
            b: to,
            endedBy: senderId!,
            rejected: true,
            io,
          });
        });
      });

      socket.on("peer-nego-needed", (data) => {
        const { to, offer } = data;
        guardPeerCall(socket, to, "peer-nego-needed", () => {
          socket.to(to).emit("peer-nego-needed", {
            from: socket.user?._id,
            offer,
          });
        });
      });

      socket.on("peer-nego-done", (data) => {
        const { to, ans } = data;
        guardPeerCall(socket, to, "peer-nego-done", () => {
          socket.to(to).emit("peer-nego-final", {
            from: socket.user?._id,
            ans,
          });
        });
      });

      socket.on("ice-candidate", (data) => {
        const { to, candidate } = data;
        guardPeerCall(socket, to, "ice-candidate", () => {
          socket.to(to).emit("ice-candidate", {
            from: socket.user?._id,
            candidate,
          });
        });
      });

      socket.on("call-ended", (data) => {
        const { to } = data;
        const senderId = socket.user?._id?.toString();
        guardPeerCall(socket, to, "call-ended", () => {
          socket.to(to).emit("call-ended", {
            from: socket.user?._id,
          });
          deregisterCall(senderId!, to);
          void endP2PCall({ a: senderId!, b: to, endedBy: senderId!, io });
        });
      });

      // Relay media state (mute/video-off) between P2P call peers
      socket.on("peer-media-state", (data: { to: string; audio?: boolean; video?: boolean }) => {
        guardPeerCall(socket, data?.to, "peer-media-state", () => {
          socket.to(data.to).emit("peer-media-state", {
            from: socket.user?._id,
            audio: data.audio,
            video: data.video,
          });
        });
      });

      // Group call events
      socket.on("group-call-invite", (data) => {
        const { roomId, callType, participants } = data;
        const senderId = socket.user?._id?.toString();
        void (async () => {
          if (!(await isChatParticipant(senderId, roomId))) {
            logger.warn(
              `[socket] denied group-call-invite: user=${senderId} room=${String(roomId)}`,
            );
            return;
          }
          // `participants` arrives from the client, so it cannot be trusted as
          // an address list -- intersecting it with the chat's real membership
          // stops a member of one group from using it to ring every user id
          // they can guess.
          const members = await getChatMembers(roomId);
          const allowed = new Set(members ?? []);
          startGroupCall({
            roomId,
            callType: callType as CallType,
            initiatorId: senderId!,
          });
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
          const targets = Array.isArray(participants) ? participants : [];
          targets.forEach((participantId: string) => {
            if (!allowed.has(participantId)) return;
            if (participantId === senderId) return;
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
        })().catch((error: unknown) => {
          logger.error(
            `[socket] group-call-invite failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        });
      });

      socket.on("group-call-accepted", (data) => {
        const { roomId } = data;
        const senderId = socket.user?._id?.toString();
        guardRoom(socket, roomId, "group-call-accepted", () => {
          markGroupCallJoined(roomId, senderId!);
          socket.to(roomId).emit("group-call-participant-joined", {
            participantId: socket.user?._id,
          });
        });
      });

      socket.on("group-call-rejected", (data) => {
        const { roomId } = data;
        guardRoom(socket, roomId, "group-call-rejected", () => {
          socket.to(roomId).emit("group-call-participant-rejected", {
            participantId: socket.user?._id,
          });
        });
      });

      // A member hung up on purpose. This is the normal exit path (the
      // `disconnect` handler only covers tab-close/crash), and it lets the
      // server log the call as soon as the last participant walks out.
      socket.on("group-call-member-left", (data) => {
        const { roomId } = data;
        const senderId = socket.user?._id?.toString();
        if (!roomId || !senderId) return;
        guardRoom(socket, roomId, "group-call-member-left", () => {
          void markGroupCallLeft({ roomId, userId: senderId!, io });
        });
      });

      socket.on("group-call-media-state", (data) => {
        const { roomId, video, audio } = data;
        if (!roomId) return;
        guardRoom(socket, roomId, "group-call-media-state", () => {
          socket.to(roomId).emit("group-call-media-state-update", {
            peerId: socket.user?._id,
            video,
            audio,
          });
        });
      });

      socket.on("group-call-ended", (data) => {
        const { roomId } = data;
        const senderId = socket.user?._id?.toString();
        // Previously anyone could end someone else's ongoing call by emitting to
        // a roomId they were not in -- a real time denial of service on calls.
        guardRoom(socket, roomId, "group-call-ended", () => {
          socket.to(roomId).emit("group-call-ended", {
            endedBy: socket.user?._id,
          });
          // One log for the whole call: whoever reports the end first claims the
          // session, and any later report from another member is discarded.
          if (senderId) void endGroupCall({ roomId, endedBy: senderId, io });
        });
      });

      // The initiator cancelled/left the call before (or even after) people
      // joined — dismiss any pending incoming-call popups and make everyone
      // who did join tear down their session so nobody is left in a void call.
      socket.on("group-call-cancelled", (data) => {
        const { roomId, participants } = data;
        if (!roomId) return;
        const senderId = socket.user?._id?.toString();
        guardRoom(socket, roomId, "group-call-cancelled", () => {
          // The initiator abandoned the call. If people had already joined this
          // resolves to a completed log; if nobody joined, to a cancelled one.
          if (senderId) void endGroupCall({ roomId, endedBy: senderId, io });
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
          // reached via their own user-id room. The list is client-supplied, so
          // it is filtered to the chat's real members for the same reason as
          // group-call-invite.
          void (async () => {
            const members = await getChatMembers(roomId);
            const allowed = new Set(members ?? []);
            const targets = Array.isArray(participants) ? participants : [];
            targets.forEach((participantId: string) => {
              if (!allowed.has(participantId)) return;
              if (participantId === senderId) return;
              socket.to(participantId).emit("group-call-cancelled", payload);
            });
          })().catch((error: unknown) => {
            logger.error(
              `[socket] group-call-cancelled targeted relay failed: ${
                error instanceof Error ? error.message : "unknown error"
              }`,
            );
          });
        });
      });

      socket.on(ChatEventEnum.DISCONNECT_EVENT, () => {
        if (socket.user?._id) {
          const userId = socket.user._id.toString();
          // If the user was in an active call, forcefully notify the peer so
          // their UI doesn't get stuck on the call screen.
          const peers = deregisterUserCalls(userId);
          peers.forEach((peerId) => {
            io.to(peerId).emit("call-ended", { from: userId });
          });
          // Close out any call the user was in — 1:1 or a group they started
          // — so a closed tab doesn't leave a call permanently "in progress".
          // No-op if the client already reported the call ended.
          void finalizeCallsForUser(userId, io);
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
  const io = req.app.get("io") as Server;

  if (!io) {
    logger.error(`[socket] Cannot emit "${event}": no io instance on req.app`);
    return;
  }

  io.in(roomId).emit(event, payload);
};

export { initializeSocketIO, emitSocketEvent };
