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
 * One user's reaction to a message.
 *
 * `user` arrives already populated by the server aggregation, so it carries a
 * username and avatar rather than just an id. It stays optional because a
 * reaction from a since-deleted user keeps only its raw id.
 */
export interface MessageReactionInterface {
  user: Partial<Pick<UserInterface, "_id" | "avatar" | "username">> & { _id?: string };
  emoji: string;
}

export interface ChatMessageInterface {
  _id: string;
  sender: Pick<UserInterface, "_id" | "avatar" | "email" | "username">;
  content: string;
  chat: string;
  /** True for optimistic/local messages that haven't reached the server yet. */
  sending?: boolean;
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
