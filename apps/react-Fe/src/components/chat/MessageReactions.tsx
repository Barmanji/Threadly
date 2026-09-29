import { FaceSmileIcon } from "@heroicons/react/20/solid";
import { useEffect, useRef, useState } from "react";
import type { MessageReactionInterface } from "../../interfaces/chat";
import { classNames } from "../../utils";

/** The emojis offered in the picker. Must mirror the server's allow-list. */
export const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥"] as const;

interface ReactionGroup {
  emoji: string;
  count: number;
  /** Usernames, for the hover tooltip. */
  names: string[];
  /** True when the current user is among the reactors. */
  includesMe: boolean;
}

/**
 * Collapse a flat reaction list into one entry per emoji.
 *
 * Reactions arrive newest-last and may repeat the same emoji across several
 * participants, so they have to be grouped and counted before rendering.
 * Group order follows first appearance, which keeps a bubble's chips stable
 * instead of reshuffling as people react.
 */
export const groupReactions = (
  reactions: MessageReactionInterface[] | undefined,
  myUserId: string | undefined,
): ReactionGroup[] => {
  const groups = new Map<string, ReactionGroup>();

  for (const reaction of reactions ?? []) {
    const reactorId = reaction.user?._id ? String(reaction.user._id) : "";
    const existing = groups.get(reaction.emoji);

    if (existing) {
      existing.count += 1;
      if (reaction.user?.username) existing.names.push(reaction.user.username);
      if (reactorId && reactorId === String(myUserId)) existing.includesMe = true;
    } else {
      groups.set(reaction.emoji, {
        emoji: reaction.emoji,
        count: 1,
        names: reaction.user?.username ? [reaction.user.username] : [],
        includesMe: Boolean(reactorId && reactorId === String(myUserId)),
      });
    }
  }

  return [...groups.values()];
};

interface ReactionPickerProps {
  onReact: (emoji: string) => void;
  /** The current user's existing reaction, highlighted in the picker. */
  myReaction: string | null;
  disabled?: boolean;
}

/**
 * The emoji trigger plus its popover.
 *
 * Rendered inside the bubble, positioned above it, and kept open on hover so
 * a reaction can be chosen without a second click. Touch devices have no
 * hover, so the button toggles the popover as well.
 *
 * Two details make the hover actually usable:
 *
 *  - The popover's box is flush against the trigger. An earlier version put an
 *    8px margin between them, and `margin` is not part of an element's hit
 *    area — the pointer crossed that gap, `mouseleave` fired, and the popover
 *    unmounted before the cursor arrived. It was unreachable, not just fiddly.
 *    The gap is now padding on the far side, so trigger and popover are one
 *    continuous box.
 *
 *  - Closing is deferred briefly, so a flick that clips a corner on the way up
 *    doesn't kill the popover mid-trajectory.
 */
const ReactionPicker: React.FC<ReactionPickerProps> = ({
  onReact,
  myReaction,
  disabled,
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingClose = () => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  // Hover-open is only wired up where hovering is a real, separate gesture.
  // On touch, `mouseenter` arrives as part of the tap, so leaving it enabled
  // would close the popover the instant the finger lifted.
  const canHover =
    typeof window !== "undefined" &&
    window.matchMedia("(hover: hover)").matches;

  const openNow = () => {
    cancelPendingClose();
    setOpen(true);
  };

  const closeSoon = () => {
    cancelPendingClose();
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 150);
  };

  // Close on an outside click or Escape rather than leaving the popover
  // stranded over the message list.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        cancelPendingClose();
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      cancelPendingClose();
      setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // A pending close that fires after unmount would be a state update on a dead
  // component — and on a message that scrolled away, that means nothing at all.
  useEffect(() => cancelPendingClose, []);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={canHover ? openNow : undefined}
      onMouseLeave={canHover ? closeSoon : undefined}
    >
      <button
        type="button"
        aria-label="React to this message"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-ink/5 text-ink/60 transition-colors hover:bg-ink/15 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
      >
        <FaceSmileIcon className="h-4 w-4" />
      </button>

      {open ? (
        /* `bottom-full` puts this box's bottom edge exactly on the trigger's
           top edge — no gap to cross. `pb-2` supplies the visual spacing on
           the far side, inside the box. */
        <div className="absolute bottom-full right-0 z-50 flex flex-col-reverse pb-2">
          <div className="neo-sm flex gap-0.5 bg-paper p-1.5">
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`React with ${emoji}`}
                onClick={(e) => {
                  e.stopPropagation();
                  cancelPendingClose();
                  onReact(emoji);
                  setOpen(false);
                }}
                className={classNames(
                  "flex h-8 w-8 items-center justify-center text-lg transition-transform hover:scale-125 focus:scale-125 focus:outline-none",
                  myReaction === emoji ? "bg-retro-yellow" : "",
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

interface ReactionChipsProps {
  reactions: MessageReactionInterface[] | undefined;
  myUserId: string | undefined;
  onReact: (emoji: string) => void;
  disabled?: boolean;
}

/**
 * The stacked chips along the bottom edge of a bubble.
 *
 * A chip is clickable: clicking your own reaction removes it, clicking a
 * different one replaces it. Reactions from other people are shown but not
 * removable by clicking — that would read as "remove Bob's reaction".
 */
export const ReactionChips: React.FC<ReactionChipsProps> = ({
  reactions,
  myUserId,
  onReact,
  disabled,
}) => {
  const groups = groupReactions(reactions, myUserId);
  if (groups.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {groups.map((group) => (
        <button
          key={group.emoji}
          type="button"
          disabled={disabled}
          title={
            group.names.length > 0
              ? group.names.join(", ")
              : `${group.count} reaction${group.count === 1 ? "" : "s"}`
          }
          onClick={(e) => {
            e.stopPropagation();
            // Only the current user's own reaction is toggleable.
            if (group.includesMe) onReact(group.emoji);
          }}
          className={classNames(
            "inline-flex items-center gap-1 border-2 px-1.5 py-0.5 text-xs leading-none transition-colors",
            group.includesMe
              ? "cursor-pointer border-ink bg-retro-yellow"
              : "cursor-default border-ink/30 bg-ink/5",
            disabled ? "cursor-not-allowed opacity-60" : "",
          )}
        >
          <span aria-hidden="true">{group.emoji}</span>
          {group.count > 1 ? (
            <span className="font-bold tabular-nums">{group.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
};

export default ReactionPicker;
