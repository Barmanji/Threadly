import mongoose from "mongoose";
import type { Server } from "socket.io";
import { ChatEventEnum } from "../constants.js";
import { Chat } from "../models/chat/chat.model.js";
import { ChatMessage } from "../models/chat/message.model.js";
import { chatMessageCommonAggregation } from "../utils/messageAggregation.js";
import logger from "../logger/winston.logger.js";

export type CallType = "audio" | "video";
export type CallStatus = "completed" | "missed" | "rejected" | "cancelled";

interface CallSession {
  chatId: string;
  callType: CallType;
  isGroup: boolean;
  /** Whoever started the call. Also the sender of the resulting message. */
  initiatorId: string;
  /** The other party on a 1:1 call. Unused for group calls. */
  peerId?: string;
  /**
   * Users who ever answered or joined. This is what separates a "missed" or
   * "cancelled" log from a "completed" one, so it only ever grows.
   */
  answered: Set<string>;
  /**
   * Users believed to be in the call right now. Only group calls use this,
   * and only to know when the last person has left.
   */
  present: Set<string>;
  /** Epoch ms of the first join. 0 while the call is still ringing. */
  startedAt: number;
}

/**
 * In-flight calls, keyed by a direction-independent identifier:
 *   `p2p:<lowerUserId>:<higherUserId>` and `group:<chatId>`.
 *
 * The server owns this map so exactly one call-log message is written per
 * call. A call can be reported finished several times — both peers may emit
 * `call-ended`, the initiator may also disconnect, and every member of a group
 * call can leave — so the map doubles as the dedupe guard: the entry is
 * removed synchronously by whoever gets there first, and every later report
 * finds nothing and does nothing.
 *
 * This is process-local. A multi-instance deployment would need it in Redis,
 * but the app already keeps `activeCalls` in memory for the same reason.
 */
const sessions = new Map<string, CallSession>();

const p2pKey = (a: string, b: string): string =>
  `p2p:${[a, b].sort().join(":")}`;

const groupKey = (roomId: string): string => `group:${roomId}`;

/** "12m 05s", "45s" — matches the way a phone shows a call duration. */
const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
};

/** The plain-text form, used in the chat list and by non-call-aware clients. */
const describeCall = (
  callType: CallType,
  status: CallStatus,
  isGroup: boolean,
  durationSeconds: number,
): string => {
  const label = `${callType === "video" ? "Video" : "Voice"} call`;
  switch (status) {
    case "completed":
      return durationSeconds > 0
        ? `${label} · ${formatDuration(durationSeconds)}`
        : label;
    case "missed":
      return `Missed ${label.toLowerCase()}`;
    case "rejected":
      return `Declined ${label.toLowerCase()}`;
    case "cancelled":
      return `${isGroup ? "Group " : ""}${label.toLowerCase()} cancelled`;
  }
};

/**
 * Write the call-log message and tell every participant about it.
 *
 * Runs fire-and-forget from socket handlers: a failure here logs and returns
 * rather than throwing, because a missing call-log entry is a cosmetic
 * problem while an unhandled rejection in a socket handler can take down the
 * process.
 */
const writeCallMessage = async (
  io: Server,
  session: CallSession,
  outcome: { status: CallStatus; endedBy: string },
): Promise<void> => {
  const { chatId, callType, isGroup, initiatorId, startedAt } = session;

  const durationSeconds =
    outcome.status === "completed" && startedAt > 0
      ? Math.max(1, Math.round((Date.now() - startedAt) / 1000))
      : 0;

  try {
    // Re-read the chat rather than trusting a cached participant list: the
    // call may have lasted minutes and membership may have changed since.
    const chat = await Chat.findById(chatId).select("participants");
    if (!chat) {
      // The chat was deleted while the call was running. Nothing to attach a
      // message to, and no members left to notify.
      return;
    }

    const message = await ChatMessage.create({
      sender: new mongoose.Types.ObjectId(initiatorId),
      chat: new mongoose.Types.ObjectId(chatId),
      type: "call",
      content: describeCall(callType, outcome.status, isGroup, durationSeconds),
      call: {
        callType,
        status: outcome.status,
        durationSeconds,
        endedBy: new mongoose.Types.ObjectId(outcome.endedBy),
        isGroup,
      },
    });

    await Chat.findByIdAndUpdate(chatId, {
      $set: { lastMessage: message._id },
    });

    const [structured] = await ChatMessage.aggregate([
      { $match: { _id: message._id } },
      ...chatMessageCommonAggregation(),
    ]);

    if (!structured) return;

    // Emitted to every participant, including whoever ended the call. Unlike a
    // normal message there is no optimistic copy on any client to reconcile
    // against, so the initiator needs the echo too.
    chat.participants.forEach((participantId: mongoose.Types.ObjectId) => {
      io.to(participantId.toString()).emit(
        ChatEventEnum.MESSAGE_RECEIVED_EVENT,
        structured,
      );
    });
  } catch (error) {
    logger.error(
      `[callLog] Failed to write call message for chat ${chatId}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
};

/**
 * Claim a session for finalization and write its log.
 *
 * The delete happens synchronously, before the first `await`, and every
 * caller is a socket event handler on the same thread — so two reports for the
 * same call cannot both win. This is the "exactly one message per call"
 * guarantee.
 */
const finalize = (
  io: Server,
  key: string,
  endedBy: string,
  resolveStatus: (session: CallSession) => CallStatus,
): Promise<void> => {
  const session = sessions.get(key);
  if (!session) return Promise.resolve();

  const status = resolveStatus(session);
  sessions.delete(key);

  return writeCallMessage(io, session, { status, endedBy });
};

const completedIfAnswered = (session: CallSession): CallStatus =>
  session.answered.size > 0 ? "completed" : "cancelled";

/* ------------------------------------------------------------------ *
 * 1:1 calls
 * ------------------------------------------------------------------ */

export const startP2PCall = (input: {
  callerId: string;
  calleeId: string;
  chatId?: string;
  callType: CallType;
}): void => {
  const { callerId, calleeId, chatId, callType } = input;
  // No chat id means the client didn't tell us where to file the log. The
  // call still works; it just won't produce a message.
  if (!callerId || !calleeId || !chatId) return;

  const key = p2pKey(callerId, calleeId);
  // Glare: both users dialed each other, so this fires twice for the same
  // call. Keep the first session — they're indistinguishable, and either
  // chatId is the same conversation.
  if (sessions.has(key)) return;

  sessions.set(key, {
    chatId,
    callType,
    isGroup: false,
    initiatorId: callerId,
    peerId: calleeId,
    answered: new Set(),
    present: new Set(),
    startedAt: 0,
  });
};

/** The call was answered — start the clock if this is the first answer. */
export const markCallAnswered = (a: string, b: string): void => {
  if (!a || !b) return;
  const session = sessions.get(p2pKey(a, b));
  if (!session) return;
  if (session.startedAt === 0) session.startedAt = Date.now();
  session.answered.add(a);
  session.present.add(a);
};

/**
 * Finish a 1:1 call.
 *
 * `rejected` distinguishes an explicit decline from the caller giving up (or
 * either side dropping), because those read very differently to the person
 * who was called.
 */
export const endP2PCall = (input: {
  a: string;
  b: string;
  endedBy: string;
  rejected?: boolean;
  io: Server;
}): Promise<void> => {
  const { a, b, endedBy, rejected, io } = input;
  if (!a || !b) return Promise.resolve();

  return finalize(io, p2pKey(a, b), endedBy, (session) => {
    if (rejected) return "rejected";
    return session.answered.size > 0 ? "completed" : "missed";
  });
};

/* ------------------------------------------------------------------ *
 * Group calls
 * ------------------------------------------------------------------ */

export const startGroupCall = (input: {
  roomId: string;
  callType: CallType;
  initiatorId: string;
}): void => {
  const { roomId, callType, initiatorId } = input;
  if (!roomId || !initiatorId) return;

  const key = groupKey(roomId);
  // A second invite from the same initiator while the call is up is just the
  // client re-targeting people who joined late — not a new call.
  if (sessions.has(key)) return;

  sessions.set(key, {
    // The client uses the chat id as the call room id.
    chatId: roomId,
    callType,
    isGroup: true,
    initiatorId,
    answered: new Set(),
    present: new Set(),
    startedAt: 0,
  });
};

/** Note that a member actually entered the call, and start its clock. */
export const markGroupCallJoined = (roomId: string, userId: string): void => {
  if (!roomId || !userId) return;
  const session = sessions.get(groupKey(roomId));
  if (!session) return;
  if (session.startedAt === 0) session.startedAt = Date.now();
  session.answered.add(userId);
  session.present.add(userId);
};

/**
 * Note that a member left the call.
 *
 * A group call keeps running as people come and go, so this only logs anything
 * when the last participant walks out — at which point the whole call is over.
 * One message, regardless of how many people joined and left along the way.
 */
export const markGroupCallLeft = (input: {
  roomId: string;
  userId: string;
  io: Server;
}): Promise<void> => {
  const { roomId, userId, io } = input;
  if (!roomId || !userId) return Promise.resolve();

  const key = groupKey(roomId);
  const session = sessions.get(key);
  if (!session) return Promise.resolve();

  session.present.delete(userId);
  if (session.present.size > 0) return Promise.resolve();

  return finalize(io, key, userId, completedIfAnswered);
};

export const endGroupCall = (input: {
  roomId: string;
  endedBy: string;
  io: Server;
}): Promise<void> => {
  const { roomId, endedBy, io } = input;
  if (!roomId) return Promise.resolve();

  return finalize(io, groupKey(roomId), endedBy, (session) =>
    // Nobody ever joined: the invite went out and was ignored or dismissed,
    // which is a cancelled call rather than a completed one.
    completedIfAnswered(session),
  );
};

/* ------------------------------------------------------------------ *
 * Disconnects
 * ------------------------------------------------------------------ */

/**
 * Finalize every call this user was part of, because their socket is gone.
 *
 * Covers the tab-close / reload / crash cases where the client never gets to
 * emit `call-ended` or `group-call-member-left`.
 */
export const finalizeCallsForUser = (
  userId: string,
  io: Server,
): Promise<void[]> => {
  if (!userId) return Promise.resolve([]);

  const tasks: Promise<void>[] = [];

  // Snapshot the keys: `finalize` mutates the map as it goes.
  for (const key of [...sessions.keys()]) {
    const session = sessions.get(key);
    if (!session) continue;

    if (session.isGroup) {
      // Same rule as an explicit leave: the call outlives any one member, and
      // only ends once the last of them is gone.
      session.present.delete(userId);
      if (session.present.size > 0) continue;
      tasks.push(finalize(io, key, userId, completedIfAnswered));
      continue;
    }

    // A 1:1 call ends when either side goes away.
    if (session.initiatorId !== userId && session.peerId !== userId) continue;
    tasks.push(
      finalize(io, key, userId, (s) =>
        s.answered.size > 0 ? "completed" : "missed",
      ),
    );
  }

  return Promise.all(tasks);
};
