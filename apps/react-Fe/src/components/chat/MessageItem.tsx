import {
    ArrowDownTrayIcon,
    DocumentIcon,
    EllipsisVerticalIcon,
    MagnifyingGlassPlusIcon,
    PaperClipIcon,
    TrashIcon,
    XMarkIcon,
} from "@heroicons/react/20/solid";
import moment from "moment";
import { useEffect, useState } from "react";
import type { ChatMessageInterface } from "../../interfaces/chat";
import { classNames, formatBytes, getFileKind, downloadFile } from "../../utils";
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

    // Close the enlarged-image viewer when the user presses Escape.
    useEffect(() => {
        if (!resizedImage) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") setResizedImage(null);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [resizedImage]);

    const handleDownload = (
        e: React.MouseEvent,
        url: string,
        fileName?: string,
    ) => {
        e.preventDefault();
        e.stopPropagation();
        void downloadFile(
            url,
            fileName || url.split("?")[0].split("/").pop() || "download",
        );
    };

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
                    {isOwnMessage && !message.sending ? (
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
                                    "grid max-w-xl gap-2",
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
                                    const kind = getFileKind(
                                        file.url,
                                        file.mimetype,
                                    );
                                    const isFileCard =
                                        kind === "pdf" || kind === "file";
                                    return (
                                        <div
                                            key={file._id || file.url}
                                            className={classNames(
                                                "group relative overflow-hidden border-2 border-ink",
                                                kind === "image"
                                                    ? "aspect-square cursor-pointer"
                                                    : kind === "video"
                                                    ? "aspect-video bg-black"
                                                    : "h-24 bg-retro-yellow cursor-pointer",
                                            )}
                                        >
                                            {kind === "image" ? (
                                                <>
                                                    <button
                                                        onClick={() =>
                                                            setResizedImage(
                                                                file.url,
                                                            )
                                                        }
                                                        className="absolute inset-0 z-20 flex justify-center items-center w-full gap-2 h-full bg-black/60 group-hover:opacity-100 opacity-0 transition-opacity ease-in-out duration-150"
                                                    >
                                                        <MagnifyingGlassPlusIcon className="h-6 w-6 text-white" />
                                                    </button>
                                                    <img
                                                        className="h-full w-full object-cover"
                                                        src={file.url}
                                                        alt="msg_img"
                                                    />
                                                </>
                                            ) : kind === "video" ? (
                                                <video
                                                    controls
                                                    playsInline
                                                    preload="metadata"
                                                    src={file.url}
                                                    className="h-full w-full object-contain"
                                                />
                                            ) : isFileCard ? (
                                                <div className="flex h-full w-full items-center gap-2 p-2">
                                                    <DocumentIcon className="h-8 w-8 flex-shrink-0 text-ink" />
                                                    <div className="min-w-0">
                                                        <p className="truncate text-xs font-bold text-ink">
                                                            {file.fileName ||
                                                                file.url
                                                                    .split(
                                                                        "?",
                                                                    )[0]
                                                                    .split("/")
                                                                    .pop()}
                                                        </p>
                                                        <p className="text-[10px] font-semibold text-ink/70">
                                                            {formatBytes(
                                                                file.size,
                                                            )}
                                                        </p>
                                                    </div>
                                                </div>
                                            ) : null}
                                            {!message.sending ? (
                                                <button
                                                    title="download"
                                                    onClick={(e) =>
                                                        handleDownload(
                                                            e,
                                                            file.url,
                                                            file.fileName,
                                                        )
                                                    }
                                                    className="absolute top-1 right-1 z-30 flex h-6 w-6 items-center justify-center bg-black/60 hover:bg-retro-orange"
                                                >
                                                    <ArrowDownTrayIcon className="h-4 w-4 text-white" />
                                                </button>
                                            ) : null}
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
                    {message.sending ? (
                        <p className="mt-1.5 text-[10px] font-bold text-ink/60 inline-flex items-center gap-1.5">
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink/60 border-t-transparent" />
                            sending…
                        </p>
                    ) : (
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
                    )}
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