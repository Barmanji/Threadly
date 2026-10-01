import mongoose from "mongoose";
import { Chat } from "../models/chat/chat.model.js";
import logger from "../logger/winston.logger.js";

/**
 * Chat membership lookups for the socket layer.
 *
 * The HTTP controllers already scope every query by `participants`; the socket
 * handlers did not, so any authenticated socket could join any room by id and
 * then read or write that room's traffic. This is the socket-side equivalent of
 * `ensureChatParticipant`, but with a cache, because unlike an HTTP request a
 * single chat page fires typing events continuously and a whiteboard relays a
 * full scene on every refresh.
 *
 * The cache is a deliberate trade: membership is re-read from Mongo at most
 * once per TTL, so a user removed from a group keeps socket access for up to
 * TTL_MS. Callers that change membership call `invalidateChatAccess` so the
 * usual path has no window at all.
 */

const TTL_MS = 30_000;

/**
 * Bounds memory. A busy box sees one entry per chat that anyone has touched;
 * without a ceiling that map only ever grows. Eviction is first-in-first-out,
 * which is approximate but adequate for a 30-second cache.
 */
const MAX_ENTRIES = 5_000;

type CacheEntry = {
  members: Set<string>;
  expiresAt: number;
};

const membershipCache = new Map<string, CacheEntry>();

/**
 * Drop the cached membership for a chat. Called whenever a controller changes
 * who is in a chat, so the change is visible to sockets immediately rather than
 * after the TTL.
 */
const invalidateChatAccess = (chatId: string): void => {
  membershipCache.delete(chatId);
};

const remember = (chatId: string, members: Set<string>): void => {
  membershipCache.set(chatId, { members, expiresAt: Date.now() + TTL_MS });
  if (membershipCache.size > MAX_ENTRIES) {
    const oldest = membershipCache.keys().next().value;
    if (oldest !== undefined) membershipCache.delete(oldest);
  }
};

/**
 * Resolve the member ids of a chat, or null when the chat does not exist.
 *
 * A chat that does not exist is cached as an empty set. That is deliberate: it
 * stops a client guessing ids in a loop from turning into a stream of Mongo
 * lookups, and an empty set can never satisfy a membership check.
 */
const getChatMembers = async (
  chatId: string,
): Promise<Set<string> | null> => {
  const cached = membershipCache.get(chatId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.members;
  }

  // Reject junk before it reaches the driver, so a malformed id cannot throw
  // inside a socket handler (where the rejection would be unhandled).
  if (!mongoose.isValidObjectId(chatId)) return null;

  try {
    // `.lean()` widens the projected document to a shape that no longer knows
    // about `participants`, so the projection is restated here rather than
    // reaching for `any` at every use.
    const chat = (await Chat.findById(chatId)
      .select("participants")
      .lean()) as { participants?: mongoose.Types.ObjectId[] } | null;
    if (!chat) {
      remember(chatId, new Set());
      return null;
    }
    const members = new Set(
      (chat.participants ?? []).map((p) => p.toString()),
    );
    remember(chatId, members);
    return members;
  } catch (error) {
    // Fail closed. If the database is briefly unavailable, refusing the event
    // is recoverable; allowing it would silently reopen the hole.
    logger.error(
      `[socket] membership lookup failed for chat ${chatId}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
    return null;
  }
};

/**
 * True only if `userId` is a participant of `chatId`.
 *
 * Anything unexpected — missing ids, a non-string chatId, a chat that does not
 * exist, a failed lookup — is false. Callers treat false as "do not relay".
 */
const isChatParticipant = async (
  userId: string | undefined,
  chatId: unknown,
): Promise<boolean> => {
  if (!userId || typeof chatId !== "string" || !chatId) return false;
  const members = await getChatMembers(chatId);
  return members !== null && members.has(userId);
};

export { getChatMembers, invalidateChatAccess, isChatParticipant };
