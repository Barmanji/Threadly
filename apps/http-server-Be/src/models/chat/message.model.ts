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
