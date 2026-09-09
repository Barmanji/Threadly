import {
    ArrowDownTrayIcon,
    EllipsisVerticalIcon,
    MagnifyingGlassPlusIcon,
    PaperClipIcon,
    TrashIcon,
    XMarkIcon,
} from "@heroicons/react/20/solid";
import moment from "moment";
import { useState } from "react";
import type { ChatMessageInterface } from "../../interfaces/chat";
import { classNames } from "../../utils";
import RetroConfirm from "../RetroConfirm";
const MessageItem: React.FC<{
    isOwnMessage?: boolean;
    isGroupChatMessage?: boolean;
    message: ChatMessageInterface;
    deleteChatMessage: (message: ChatMessageInterface) => void;
}> = ({ message, isOwnMessage, isGroupChatMessage, deleteChatMessage }) => {
    const [resizedImage, setResizedImage] = useState<string | null>(null);
    const [openOptions, setopenOptions] = useState<boolean>(false);
    const [confirmDeleteMessage, setConfirmDeleteMessage] =
        useState<boolean>(false);

    return (
        <>
            {resizedImage ? (
                <div className="h-full z-40 p-8 overflow-hidden w-full absolute inset-0 bg-black/70 flex justify-center items-center">
                    <XMarkIcon
                        className="absolute top-5 right-5 w-9 h-9 text-white cursor-pointer"
                        onClick={() => setResizedImage(null)}
                    />
                    <img
                        className="w-full h-full object-contain"
                        src={resizedImage}
                        alt="chat image"
                    />
                </div>
            ) : null}
            <div
                className={classNames(
                    "relative flex justify-start items-end gap-3 max-w-lg",
                    isOwnMessage ? "ml-auto flex-row-reverse" : "",
                )}
            >
                <img
                    src={message.sender?.avatar}
                    className="h-7 w-7 object-cover rounded-sm border-2 border-ink flex flex-shrink-0"
                />
                <div
                    className={classNames(
                        " relative p-4 flex flex-col cursor-pointer border-2 border-ink shadow-[3px_3px_0_0_var(--color-ink)]",
                        isOwnMessage
                            ? "rounded-tr-none bg-retro-orange pr-10"
                            : "rounded-tl-none bg-white",
                    )}
                >
                    {isOwnMessage ? (
                        <div className="absolute top-2 right-2 z-30">
                            <button
                                className="p-1 options-button"
                                onClick={() => setopenOptions(!openOptions)}
                            >
                                <EllipsisVerticalIcon className="h-5 w-5" />
                            </button>
                            {openOptions ? (
                                <div className="neo-sm absolute right-0 mt-2 w-40 bg-paper text-left z-40">
                                    <p
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setopenOptions(false);
                                            setConfirmDeleteMessage(true);
                                        }}
                                        role="button"
                                        className="inline-flex items-center gap-2 p-3 text-sm font-bold text-retro-red hover:bg-retro-red hover:text-paper"
                                    >
                                        <TrashIcon className="h-4 w-4" />
                                        Delete Message
                                    </p>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    {isGroupChatMessage && !isOwnMessage ? (
                        <p
                            className={classNames(
                                "text-xs font-semibold mb-2",
                                ["text-success", "text-danger"][
                                message.sender.username.length % 2
                                ],
                            )}
                        >
                            {message.sender?.username}
                        </p>
                    ) : null}
                    {message?.attachments?.length > 0 ? (
                        <div>
                            <div
                                className={classNames(
                                    "grid max-w-7xl gap-2",
                                    message.attachments?.length === 1
                                        ? " grid-cols-1"
                                        : "",
                                    message.attachments?.length === 2
                                        ? " grid-cols-2"
                                        : "",
                                    message.attachments?.length >= 3
                                        ? " grid-cols-3"
                                        : "",
                                    message.content ? "mb-6" : "",
                                )}
                            >
                                {message.attachments?.map((file) => {
                                    return (
                                        <div
                                            key={file._id}
                                            className="group relative aspect-square rounded-xl overflow-hidden cursor-pointer"
                                        >
                                            <button
                                                onClick={() =>
                                                    setResizedImage(file.url)
                                                }
                                                className="absolute inset-0 z-20 flex justify-center items-center w-full gap-2 h-full bg-black/60 group-hover:opacity-100 opacity-0 transition-opacity ease-in-out duration-150"
                                            >
                                                <MagnifyingGlassPlusIcon className="h-6 w-6 text-white" />
                                                <a
                                                    href={file.url}
                                                    download
                                                    onClick={(e) =>
                                                        e.stopPropagation()
                                                    }
                                                >
                                                    <ArrowDownTrayIcon
                                                        title="download"
                                                        className="hover:text-retro-orange h-6 w-6 text-white cursor-pointer"
                                                    />
                                                </a>
                                            </button>
                                            <img
                                                className="h-full w-full object-cover"
                                                src={file.url}
                                                alt="msg_img"
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}
                    {message.content ? (
                        <div className="relative flex justify-between">
                            <p className="text-sm text-ink">{message.content}</p>
                        </div>
                    ) : null}
                    <p
                        className={classNames(
                            "mt-1.5 self-end text-[10px] inline-flex items-center",
                            isOwnMessage ? "text-ink/70" : "text-ink/60",
                        )}
                    >
                        {message.attachments?.length > 0 ? (
                            <PaperClipIcon className="h-4 w-4 mr-2 " />
                        ) : null}
                        {moment(message.updatedAt)
                            .add("TIME_ZONE", "hours")
                            .fromNow(true)}{" "}
                        ago
                    </p>
                </div>
            </div>

            <RetroConfirm
                open={confirmDeleteMessage}
                title="Delete message"
                message="Are you sure you want to delete this message?"
                confirmText="Delete"
                onCancel={() => setConfirmDeleteMessage(false)}
                onConfirm={() => {
                    setConfirmDeleteMessage(false);
                    deleteChatMessage(message);
                }}
            />
        </>
    );
};

export default MessageItem;
