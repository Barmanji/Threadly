import type { UserInterface } from "./user";

export interface ChatListItemInterface {
  admin: string;
  createdAt: string;
  isGroupChat: true;
  lastMessage?: ChatMessageInterface;
  name: string;
  participants: UserInterface[];
  updatedAt: string;
  _id: string;
}

/**
 * One entry in a message's reaction list.
 *
 * A reaction is stored as `{ user: ObjectId, emoji }`, and the server's
 * aggregation resolves the reactor into *sibling* fields rather than nesting it
 * under `user` — so a reaction actually arrives as
 * `{ user: "<id>", emoji, _id, username, avatar }`. The resolved fields are
 * optional because a reaction from a since-deleted user keeps only the raw id.
 *
 * This matters: reading `user.username` here yields `undefined`, because
 * `user` is a bare id string. Both the id match and the display name have to
 * come from the fields the server actually sends.
 */
export interface MessageReactionInterface {
  user: string;
  emoji: string;
  _id?: string;
  username?: string;
  avatar?: string;
}

/**
 * Structured payload on a call-log message.
 *
 * A call is stored as a regular message so it sorts and paginates with the
 * conversation, but it renders as a pill rather than a paragraph. `status`
 * drives the wording; `durationSeconds` is only meaningful for `completed`.
 */
export interface CallInfoInterface {
  callType: "audio" | "video";
  status: "completed" | "missed" | "rejected" | "cancelled";
  durationSeconds: number;
  /** Who hung up / dropped / declined. Populated by the server. */
  endedBy?: Partial<Pick<UserInterface, "_id" | "avatar" | "username">> & {
    _id?: string;
  };
  isGroup: boolean;
}

export interface ChatMessageInterface {
  _id: string;
  sender: Pick<UserInterface, "_id" | "avatar" | "email" | "username">;
  content: string;
  chat: string;
  /** True for optimistic/local messages that haven't reached the server yet. */
  sending?: boolean;
  /**
   * `"call"` for server-generated call logs. Absent on older documents, so
   * treat anything other than `"call"` as a normal text message.
   */
  type?: "text" | "call";
  /** Only present when `type` is `"call"`. */
  call?: CallInfoInterface;
  attachments: {
    url: string;
    localPath?: string;
    mimetype?: string;
    fileName?: string;
    size?: number;
    _id?: string;
  }[];
  /** Emoji reactions, one entry per user, in the order they reacted. */
  reactions?: MessageReactionInterface[];
  createdAt: string;
  updatedAt: string;
}
