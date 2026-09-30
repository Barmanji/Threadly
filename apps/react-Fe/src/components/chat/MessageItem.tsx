import {
    ArrowDownTrayIcon,
    DocumentIcon,
    EllipsisVerticalIcon,
    MagnifyingGlassPlusIcon,
    PaperClipIcon,
    TrashIcon,
} from "@heroicons/react/20/solid";
import moment from "moment";
import { useEffect, useRef, useState } from "react";
import type { ChatMessageInterface } from "../../interfaces/chat";
import { classNames, formatBytes, getFileKind, downloadFile } from "../../utils";
import { REACTION_UI_ATTR, isReactionUi } from "../../utils/reactionUi";
import RetroConfirm from "../RetroConfirm";
import CallMessageBody from "./CallMessageBody";
import EmojiPicker from "./EmojiPicker";
import ImageLightbox from "./ImageLightbox";
import {
    ReactionChips,
    ReactionTrigger,
    groupReactions,
} from "./MessageReactions";

const MessageItem: React.FC<{
    isOwnMessage?: boolean;
    isGroupChatMessage?: boolean;
    message: ChatMessageInterface;
    deleteChatMessage: (message: ChatMessageInterface) => void;

    /** Toggles a reaction. Omitted renders the message read-only. */
    onReact?: (
        message: ChatMessageInterface,
        emoji: string,
    ) => void;

    /** Current user id, used to tell "my" reactions from everyone else's. */
    myUserId?: string;
}> = ({
    message,
    isOwnMessage,
    isGroupChatMessage,
    deleteChatMessage,
    onReact,
    myUserId,
}) => {
    const [resizedImage, setResizedImage] =
        useState<string | null>(null);

    const [openOptions, setopenOptions] =
        useState<boolean>(false);

    const [confirmDeleteMessage, setConfirmDeleteMessage] =
        useState<boolean>(false);

    // Touch devices have no hover, so the toolbar cannot rely on
    // group-hover — a tap on the bubble toggles it instead.
    const [touchOpen, setTouchOpen] = useState(false);

    const wrapRef = useRef<HTMLDivElement>(null);

    // The full emoji picker, opened from the trigger's "+".
    const [emojiPickerOpen, setEmojiPickerOpen] =
        useState(false);

    const [emojiAnchor, setEmojiAnchor] =
        useState<HTMLButtonElement | null>(null);

    const openEmojiPicker = (
        e: React.MouseEvent<HTMLButtonElement>,
    ) => {
        setEmojiAnchor(e.currentTarget);
        setEmojiPickerOpen(true);
    };

    /**
     * A tap on the bubble reveals the reaction trigger. Mobile only, because
     * that's the only place there is no hover to do it for us.
     *
     * The guard matters more than it looks: the trigger is a 32px button that
     * sits just outside the bubble, so a slightly-missed finger lands on the
     * bubble instead. Without this, that near-miss toggled the trigger shut
     * again — the icon vanished and nothing opened, which is the exact
     * symptom this whole dance is trying to avoid.
     */
    const handleBubbleTap = (
        e: React.MouseEvent<HTMLDivElement>,
    ) => {
        // `(hover: none)` is the reliable signal for "this device taps rather
        // than points" — a mouse can hover, a finger cannot.
        if (
            !window.matchMedia("(hover: none)")
                .matches
        ) {
            return;
        }

        // Never toggle from a tap that started on the reaction UI itself.
        if (isReactionUi(e.target)) return;

        setTouchOpen((prev) => !prev);
    };

    /**
     * Tapping outside the message closes the trigger.
     *
     * "Inside" has to cover the popovers too, not just the message wrapper.
     * Both the quick-reaction bar and the full picker are rendered through
     * `createPortal` onto `document.body`, so they are DOM siblings of the
     * whole chat page, not descendants of `wrapRef`. Testing only
     * `wrapRef.contains(target)` therefore treated every tap on an open
     * popover as an outside tap and tore the trigger down from under the
     * user's finger.
     */
    useEffect(() => {
        if (!touchOpen) return;

        const close = (e: PointerEvent) => {
            if (
                wrapRef.current?.contains(
                    e.target as Node,
                )
            ) {
                return;
            }

            if (isReactionUi(e.target)) return;

            setTouchOpen(false);
        };

        document.addEventListener(
            "pointerdown",
            close,
        );

        return () =>
            document.removeEventListener(
                "pointerdown",
                close,
            );
    }, [touchOpen]);

    // An optimistic message is still in flight, so reacting to it would hit a
    // message the server hasn't stored yet.
    const canReact =
        Boolean(onReact) && !message.sending;

    const myReaction =
        groupReactions(
            message.reactions,
            myUserId,
        ).find((g) => g.includesMe)?.emoji ?? null;

    const handleReact = (emoji: string) => {
        if (!canReact || !onReact) return;

        onReact(message, emoji);
    };

    const handleDownload = (
        e: React.MouseEvent,
        url: string,
        fileName?: string,
    ) => {
        e.preventDefault();
        e.stopPropagation();

        void downloadFile(
            url,
            fileName ||
                url
                    .split("?")[0]
                    .split("/")
                    .pop() ||
                "download",
        );
    };

    return (
        <>
            {/* Enlarged image viewer. Portalled to the body, so it covers the
                viewport instead of being laid out by the message it came from
                — see ImageLightbox. */}
            {resizedImage ? (
                <ImageLightbox
                    src={resizedImage}
                    onClose={() => setResizedImage(null)}
                />
            ) : null}

            {/* MESSAGE ROW */}
            <div
                ref={wrapRef}
                onClick={handleBubbleTap}
                className={classNames(
                    "group relative flex w-full max-w-[86%] items-end justify-start gap-3 sm:max-w-lg",
                    isOwnMessage
                        ? "ml-auto flex-row-reverse"
                        : "",
                )}
            >
                {/* Avatar */}
                <img
                    src={message.sender?.avatar}
                    className="flex h-7 w-7 flex-shrink-0 rounded-sm border-2 border-ink object-cover"
                />

                {/* MESSAGE BUBBLE */}
                <div
                    className={classNames(
                        /*
                         * IMPORTANT:
                         *
                         * overflow-visible is intentional.
                         *
                         * The reaction trigger is positioned relative to
                         * this bubble and sits outside its visual edge.
                         *
                         * Individual attachment cards already have their
                         * own overflow-hidden, so their contents remain
                         * clipped correctly.
                         */
                        "relative min-w-0 max-w-full overflow-visible p-4 flex flex-col cursor-pointer border-2 border-ink shadow-[3px_3px_0_0_var(--color-ink)]",

                        isOwnMessage
                            ? "rounded-tr-none bg-retro-orange pr-10"
                            : "rounded-tl-none bg-paper",
                    )}
                >
                    {/* OWN MESSAGE OPTIONS */}
                    {isOwnMessage &&
                    !message.sending ? (
                        <div className="absolute right-2 top-2 z-30">
                            <button
                                className="options-button p-1"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setopenOptions(
                                        !openOptions,
                                    );
                                }}
                            >
                                <EllipsisVerticalIcon className="h-5 w-5" />
                            </button>

                            {openOptions ? (
                                <div className="neo-sm absolute right-0 z-40 mt-2 w-40 bg-paper text-left">
                                    <p
                                        onClick={(e) => {
                                            e.stopPropagation();

                                            setopenOptions(
                                                false,
                                            );

                                            setConfirmDeleteMessage(
                                                true,
                                            );
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

                    {/* GROUP CHAT USERNAME */}
                    {isGroupChatMessage &&
                    !isOwnMessage ? (
                        <p
                            className={classNames(
                                "mb-2 text-xs font-semibold",
                                [
                                    "text-success",
                                    "text-danger",
                                ][
                                    message.sender.username
                                        .length % 2
                                ],
                            )}
                        >
                            {message.sender?.username}
                        </p>
                    ) : null}

                    {/* ATTACHMENTS */}
                    {message?.attachments?.length >
                    0 ? (
                        <div>
                            <div
                                className={classNames(
                                    "grid w-full gap-2",

                                    message.attachments
                                        ?.length === 1
                                        ? "grid-cols-1"
                                        : "",

                                    message.attachments
                                        ?.length === 2
                                        ? "grid-cols-2"
                                        : "",

                                    message.attachments
                                        ?.length >= 3
                                        ? "grid-cols-3"
                                        : "",

                                    message.content
                                        ? "mb-6"
                                        : "",
                                )}
                            >
                                {message.attachments?.map(
                                    (file) => {
                                        const kind =
                                            getFileKind(
                                                file.url,
                                                file.mimetype,
                                            );

                                        const isFileCard =
                                            kind === "pdf" ||
                                            kind ===
                                                "file";

                                        return (
                                            <div
                                                key={
                                                    file._id ||
                                                    file.url
                                                }
                                                className={classNames(
                                                    /*
                                                     * Keep attachment
                                                     * cards clipped even
                                                     * though the message
                                                     * bubble itself is now
                                                     * overflow-visible.
                                                     */
                                                    "group relative overflow-hidden border-2 border-ink",

                                                    kind ===
                                                        "image"
                                                        ? "aspect-square cursor-pointer"
                                                        : kind ===
                                                            "video"
                                                          ? "aspect-video bg-black"
                                                          : "h-24 cursor-pointer bg-retro-yellow",
                                                )}
                                            >
                                                {/* IMAGE */}
                                                {kind ===
                                                "image" ? (
                                                    <>
                                                        <button
                                                            onClick={() =>
                                                                setResizedImage(
                                                                    file.url,
                                                                )
                                                            }
                                                            className="absolute inset-0 z-20 flex h-full w-full items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity duration-150 ease-in-out group-hover:opacity-100"
                                                        >
                                                            <MagnifyingGlassPlusIcon className="h-6 w-6 text-white" />
                                                        </button>

                                                        <img
                                                            className="h-full w-full object-cover"
                                                            src={
                                                                file.url
                                                            }
                                                            alt="msg_img"
                                                        />
                                                    </>
                                                ) : kind ===
                                                  "video" ? (
                                                    /* VIDEO */
                                                    <video
                                                        controls
                                                        playsInline
                                                        preload="metadata"
                                                        src={
                                                            file.url
                                                        }
                                                        className="h-full w-full object-contain"
                                                    />
                                                ) : isFileCard ? (
                                                    /* FILE / PDF */
                                                    <div className="flex h-full w-full items-center gap-2 p-2">
                                                        <DocumentIcon className="h-8 w-8 flex-shrink-0 text-ink" />

                                                        <div className="min-w-0">
                                                            <p className="truncate text-xs font-bold text-ink">
                                                                {file.fileName ||
                                                                    file.url
                                                                        .split(
                                                                            "?",
                                                                        )[0]
                                                                        .split(
                                                                            "/",
                                                                        )
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

                                                {/* DOWNLOAD BUTTON */}
                                                {!message.sending ? (
                                                    <button
                                                        title="download"
                                                        onClick={(
                                                            e,
                                                        ) =>
                                                            handleDownload(
                                                                e,
                                                                file.url,
                                                                file.fileName,
                                                            )
                                                        }
                                                        className="absolute right-1 top-1 z-30 flex h-6 w-6 items-center justify-center bg-black/60 hover:bg-retro-orange"
                                                    >
                                                        <ArrowDownTrayIcon className="h-4 w-4 text-white" />
                                                    </button>
                                                ) : null}
                                            </div>
                                        );
                                    },
                                )}
                            </div>
                        </div>
                    ) : null}

                    {/* CALL MESSAGE / TEXT MESSAGE */}
                    {message.type === "call" &&
                    message.call ? (
                        <CallMessageBody
                            call={message.call}
                        />
                    ) : message.content ? (
                        <div className="relative flex justify-between">
                            <p className="min-w-0 break-words text-sm text-ink">
                                {message.content}
                            </p>
                        </div>
                    ) : null}

                    {/* REACTION CHIPS */}
                    <ReactionChips
                        reactions={message.reactions}
                        myUserId={myUserId}
                        onReact={handleReact}
                        disabled={!canReact}
                    />

                    {/* TIMESTAMP */}
                    <div
                        className={classNames(
                            "mt-1 flex items-center gap-1",
                            isOwnMessage
                                ? "flex-row-reverse"
                                : "",
                        )}
                    >
                        {message.sending ? (
                            <p className="inline-flex items-center gap-1.5 text-[10px] font-bold text-ink/60">
                                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-ink/60 border-t-transparent" />

                                sending…
                            </p>
                        ) : (
                            <p
                                className={classNames(
                                    "inline-flex items-center text-[10px]",

                                    isOwnMessage
                                        ? "text-ink/70"
                                        : "text-ink/60",
                                )}
                            >
                                {message.attachments
                                    ?.length >
                                0 ? (
                                    <PaperClipIcon className="mr-2 h-4 w-4" />
                                ) : null}

                                {moment(
                                    message.updatedAt,
                                )
                                    .add(
                                        "TIME_ZONE",
                                        "hours",
                                    )
                                    .fromNow(true)}{" "}
                                ago
                            </p>
                        )}
                    </div>

                    {/*
                     * REACTION TRIGGER
                     *
                     * It is technically inside the bubble's DOM,
                     * but visually outside it.
                     *
                     * Because the bubble is now overflow-visible,
                     * left-full/right-full can escape the bubble.
                     *
                     * This keeps the trigger anchored to the actual
                     * message bubble and does NOT introduce another
                     * flex wrapper, so the three-dot menu stays intact.
                     */}
{canReact ? (
    <div
        onClick={(e) => e.stopPropagation()}
        /*
         * The row's own toggle listens on `click`, but the close-on-outside
         * effect listens on `pointerdown`. Stopping propagation on only one
         * of the two left the trigger half-protected: `pointerdown` still
         * reached the document handler. Stopping both means a tap that
         * starts on the trigger can never be mistaken for a tap outside it.
         */
        onPointerDown={(e) => e.stopPropagation()}
        {...{ [REACTION_UI_ATTR]: "" }}
        className={classNames(
            "absolute top-1/2 z-40 -translate-y-1/2",
            "transition-opacity duration-100",

            isOwnMessage
                ? "right-full mr-2"
                : "left-full ml-2",

            /*
             * Exactly one of each conflicting pair is ever emitted.
             *
             * Listing "pointer-events-none opacity-0" as a fixed base class
             * and then conditionally appending "pointer-events-auto
             * opacity-100" looks equivalent, and on a mouse it is. It is not
             * on a phone. Both utilities have the same specificity, so which
             * one applies is decided purely by the order Tailwind emits them
             * in the built stylesheet -- not by their order in this string.
             * In this build `.pointer-events-none` lands at byte 7720 and
             * `.pointer-events-auto` at 7679, so `none` always won.
             *
             * That produced the exact reported symptom: the trigger turned
             * visible (because `.opacity-100` IS emitted after `.opacity-0`)
             * while remaining `pointer-events: none`, so the tap that was
             * supposed to open the picker landed on the bubble instead,
             * toggled the toolbar shut, and the icon appeared to vanish.
             * Desktop never showed it because `group-hover:` is a variant and
             * variants are emitted in a later section, after the base
             * utilities.
             */
            touchOpen
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0",

            /*
             * Desktop reveals the trigger by hover, and keyboard focus does
             * the same so the toolbar is reachable without a pointer. Both
             * are variants, so they sit after the base utilities in the sheet
             * and are not affected by the ordering above.
             */
            "group-hover:pointer-events-auto group-hover:opacity-100",

            "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
        )}
    >
        {/* Invisible bridge between bubble and reaction button */}
        <div
            className={classNames(
                "absolute top-1/2 h-10 w-4 -translate-y-1/2",

                isOwnMessage
                    ? "right-[-8px]"
                    : "left-[-8px]",
            )}
        />

        <ReactionTrigger
            onReact={handleReact}
            myReaction={myReaction}
            onMore={openEmojiPicker}
        />
    </div>
) : null}
                </div>
            </div>

            {/*
             * FULL EMOJI PICKER
             *
             * Portaled, so the scrollable message list
             * cannot clip it.
             */}
            {emojiPickerOpen &&
            emojiAnchor ? (
                <EmojiPicker
                    anchor={emojiAnchor}
                    onClose={() =>
                        setEmojiPickerOpen(false)
                    }
                    onPick={(emoji) => {
                        handleReact(emoji);
                        setEmojiPickerOpen(false);
                    }}
                    myReaction={myReaction}
                />
            ) : null}

            {/* DELETE CONFIRMATION */}
            <RetroConfirm
                open={confirmDeleteMessage}
                title="Delete message"
                message="Are you sure you want to delete this message?"
                confirmText="Delete"
                onCancel={() =>
                    setConfirmDeleteMessage(false)
                }
                onConfirm={() => {
                    setConfirmDeleteMessage(false);
                    deleteChatMessage(message);
                }}
            />
        </>
    );
};

export default MessageItem;
