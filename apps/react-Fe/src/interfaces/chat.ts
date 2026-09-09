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
  createdAt: string;
  updatedAt: string;
}
