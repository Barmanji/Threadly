import {
  EllipsisVerticalIcon,
  PaperClipIcon,
  TrashIcon,
} from "@heroicons/react/20/solid";
import { InformationCircleIcon } from "@heroicons/react/24/outline";
import moment from "moment";
import React, { useState } from "react";
import { toast } from "sonner";
import { deleteOneOnOneChat } from "../../api";
import { useAuth } from "../../context/AuthContext";
import type { ChatListItemInterface } from "../../interfaces/chat";
import { classNames, getChatObjectMetadata, requestHandler } from "../../utils";
import GroupChatDetailsModal from "./GroupChatDetailsModal";
import RetroConfirm from "../RetroConfirm";

const ChatItem: React.FC<{
  chat: ChatListItemInterface;
  onClick: (chat: ChatListItemInterface) => void;
  isActive?: boolean;
  unreadCount?: number;
  onChatDelete: (chatId: string) => void;
  typingCaption?: string | null;
}> = ({
  chat,
  onClick,
  isActive,
  unreadCount = 0,
  onChatDelete,
  typingCaption = null,
}) => {
  const { user } = useAuth();
  const [openOptions, setOpenOptions] = useState(false);
  const [openGroupInfo, setOpenGroupInfo] = useState(false);
  const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);

  const deleteChat = async () => {
    await requestHandler(
      async () => await deleteOneOnOneChat(chat._id),
      null,
      () => {
        onChatDelete(chat._id);
      },
      (err) => toast.error(err),
    );
  };

  if (!chat) return;
  return (
    <>
      <GroupChatDetailsModal
        open={openGroupInfo}
        onClose={() => {
          setOpenGroupInfo(false);
        }}
        chatId={chat._id}
        onGroupDelete={onChatDelete}
      />

      <div
        role="button"
        onClick={() => onClick(chat)}
        onMouseLeave={() => setOpenOptions(false)}
        className={classNames(
          "group my-2 flex cursor-pointer items-center justify-between gap-3 border-[3px] border-ink bg-cream p-3 transition hover:bg-retro-yellow",
          isActive ? "bg-retro-yellow" : "",
        )}
      >
        <div className="flex flex-shrink-0 items-center justify-center">
          {chat.isGroupChat ? (
            <div className="relative flex h-12 w-12 flex-shrink-0 flex-nowrap items-center justify-start">
              {chat.participants.slice(0, 3).map((participant, i) => {
                return (
                  <img
                    key={participant._id}
                    src={participant.avatar}
                    className={classNames(
                      "absolute h-8 w-8 rounded-sm border-[3px] border-ink object-cover",
                      i === 0
                        ? "left-0 z-[3]"
                        : i === 1
                          ? "left-2.5 z-[2]"
                          : i === 2
                            ? "left-[18px] z-[1]"
                            : "",
                    )}
                  />
                );
              })}
            </div>
          ) : (
            <img
              src={getChatObjectMetadata(chat, user!).avatar}
              className="h-12 w-12 flex-shrink-0 rounded-sm border-[3px] border-ink object-cover"
            />
          )}
        </div>
        <div className="w-full min-w-0">
          <p className="truncate-1 font-extrabold uppercase tracking-wide text-ink">
            {getChatObjectMetadata(chat, user!).title}
          </p>
          <div className="inline-flex w-full items-center text-left">
            {typingCaption ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex gap-0.5">
                  <span className="animation1 h-1.5 w-1.5 rounded-full bg-retro-orange" />
                  <span className="animation2 h-1.5 w-1.5 rounded-full bg-retro-orange" />
                  <span className="animation3 h-1.5 w-1.5 rounded-full bg-retro-orange" />
                </span>
                <small className="truncate-1 text-sm font-bold text-retro-orange">
                  {typingCaption}
                </small>
              </span>
            ) : (
              <>
                {chat.lastMessage && chat.lastMessage.attachments.length > 0 ? (
                  <PaperClipIcon className="mr-2 h-3 w-3 flex flex-shrink-0 text-ink/50" />
                ) : null}
                <small className="truncate-1 text-sm text-ink/60">
                  {getChatObjectMetadata(chat, user!).lastMessage}
                </small>
              </>
            )}
          </div>
        </div>
        <div className="flex h-full flex-col items-end justify-between text-sm text-ink/50">
          <small className="mb-2 inline-flex w-max flex-shrink-0">
            {moment(chat.updatedAt).add("TIME_ZONE", "hours").fromNow(true)}
          </small>

          {unreadCount <= 0 ? null : (
            <span className="neo-sm flex h-6 min-w-6 flex-shrink-0 items-center justify-center bg-retro-red px-1 text-xs text-paper">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setOpenOptions(!openOptions);
          }}
          className="neo-sm relative self-center bg-cream p-1 text-ink hover:bg-retro-orange hover:text-paper"
        >
          <EllipsisVerticalIcon className="h-6 w-6" />
          <div
            className={classNames(
              "z-20 absolute right-0 bottom-0 w-52 translate-y-full bg-cream border-[3px] border-ink p-2 text-left text-sm shadow-[4px_4px_0_0_var(--color-ink)]",
              openOptions ? "block" : "hidden",
            )}
          >
            {chat.isGroupChat ? (
              <p
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenGroupInfo(true);
                }}
                role="button"
                className="inline-flex w-full items-center p-3 font-bold text-ink hover:bg-retro-yellow"
              >
                <InformationCircleIcon className="mr-2 h-4 w-4" /> About group
              </p>
            ) : (
              <p
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteChat(true);
                }}
                role="button"
                className="inline-flex w-full items-center p-3 font-bold text-retro-red hover:bg-retro-red hover:text-paper"
              >
                <TrashIcon className="mr-2 h-4 w-4" />
                Delete chat
              </p>
            )}
          </div>
        </button>
      </div>

      <RetroConfirm
        open={confirmDeleteChat}
        title="Delete chat"
        message={`Are you sure you want to delete this conversation? This cannot be undone.`}
        confirmText="Delete"
        onCancel={() => setConfirmDeleteChat(false)}
        onConfirm={() => {
          setConfirmDeleteChat(false);
          deleteChat();
        }}
      />
    </>
  );
};

export default ChatItem;