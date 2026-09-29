import mongoose, { Schema } from "mongoose";

/**
 * A single emoji reaction.
 *
 * Stored as an array rather than a Map so the order participants reacted in
 * is preserved, which matters for the stacked chips in a group chat. The
 * "one reaction per user" invariant is enforced by an atomic update pipeline
 * in `message.controller.ts` (see `reactToMessage`) rather than by the
 * schema, because it needs a read-then-write that stays race-free.
 */
const reactionSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    emoji: {
      type: String,
      required: true,
      trim: true,
      // Emoji can be multi-codepoint (skin tones, ZWJ sequences, flags), so
      // validate on character count rather than any fixed byte length.
      validate: {
        validator: (v: string) => Array.from(v).length <= 8,
        message: "Reaction must be a single emoji",
      },
    },
  },
  { _id: false }
);

/**
 * Structured payload for a call-log message.
 *
 * A call message is still a normal message in the same collection — it has a
 * sender, a chat and a timestamp — so it sorts, paginates and paginates
 * alongside everything else, and `content` carries a plain-text description
 * for the chat list. The extra fields let the bubble render a call pill
 * instead of a paragraph.
 */
const callInfoSchema = new Schema(
  {
    callType: {
      type: String,
      enum: ["audio", "video"],
      required: true,
    },
    /**
     * - `completed` — answered, then hung up
     * - `missed`    — never answered before the caller gave up or dropped
     * - `rejected`  — the callee explicitly declined
     * - `cancelled` — a group call the initiator abandoned before anyone joined
     */
    status: {
      type: String,
      enum: ["completed", "missed", "rejected", "cancelled"],
      required: true,
    },
    durationSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Who hung up / dropped / declined. */
    endedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    /** Distinguishes a group call log from a 1:1 one, for the wording. */
    isGroup: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

// TODO: Add image and pdf file sharing in the next version
const chatMessageSchema = new Schema(
  {
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    content: {
      type: String,
    },
    /**
     * Discriminates a call log from a normal message. Defaulted so every
     * existing document — and every message written by code that doesn't set
     * it — reads back as a plain text message.
     */
    type: {
      type: String,
      enum: ["text", "call"],
      default: "text",
    },
    /** Only present when `type` is `"call"`. */
    call: {
      type: callInfoSchema,
      required: false,
      default: undefined,
    },
    attachments: {
      type: [
        {
          url: String,
          localPath: String,
          mimetype: String,
          fileName: String,
          size: Number,
        },
      ],
      default: [],
    },
    chat: {
      type: Schema.Types.ObjectId,
      ref: "Chat",
    },
    /**
     * Emoji reactions, one entry per user who has reacted.
     * The same emoji can appear multiple times — that's a group chat with
     * several people reacting — but a given user appears at most once.
     */
    reactions: {
      type: [reactionSchema],
      default: [],
    },
  },
  { timestamps: true }
);

export const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);
