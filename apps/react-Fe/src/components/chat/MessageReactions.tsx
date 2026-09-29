import { FaceSmileIcon, PlusIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MessageReactionInterface } from "../../interfaces/chat";
import { classNames } from "../../utils";
import { QUICK_REACTIONS } from "./reactionEmojis";

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

const POPOVER_WIDTH = 264;
const VIEWPORT_MARGIN = 8;

/**
 * The reaction picker popover: the quick row plus a "+" into the full picker.
 *
 * Portaled to <body> with `position: fixed`, because the message list is
 * `overflow-y-auto` and an in-place popover anchored near the top of the
 * viewport gets clipped.
 */
const ReactionPickerPopover: React.FC<{
  anchor: HTMLElement;
  onReact: (emoji: string) => void;
  onClose: () => void;
  myReaction: string | null;
  onMore: (e: React.MouseEvent<HTMLButtonElement>) => void;
}> = ({ anchor, onReact, onClose, myReaction, onMore }) => {
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const panel = panelRef.current;
      const height = panel?.offsetHeight ?? 48;

      // Centre on the trigger, then clamp so it never leaves the viewport.
      let left = rect.left + rect.width / 2 - POPOVER_WIDTH / 2;
      let top = rect.top - height - VIEWPORT_MARGIN;
      if (top < VIEWPORT_MARGIN) top = rect.bottom + VIEWPORT_MARGIN;

      left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN),
      );

      setCoords({ left, top });
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (anchor.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="React to this message"
      className="neo-sm fixed z-[100] flex items-center gap-0.5 bg-paper p-1"
      style={{
        width: POPOVER_WIDTH,
        ...(coords ?? { left: -9999, top: -9999 }),
      }}
    >
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          title={`React with ${emoji}`}
          onClick={() => {
            onReact(emoji);
            onClose();
          }}
          className={classNames(
            "flex h-8 w-8 items-center justify-center rounded-sm text-lg transition-transform hover:scale-125 focus:scale-125 focus:outline-none",
            myReaction === emoji ? "bg-retro-yellow" : "",
          )}
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-label="More emoji"
        title="More emoji"
        className="flex h-8 w-8 items-center justify-center rounded-sm text-ink/50 transition-colors hover:bg-ink/10 hover:text-ink"
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>,
    document.body,
  );
};

interface ReactionTriggerProps {
  onReact: (emoji: string) => void;
  /** The current user's existing reaction, highlighted in the picker. */
  myReaction: string | null;
  disabled?: boolean;
  /** Opens the full emoji picker instead of the quick row. */
  onMore: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

/**
 * The single grey smiley that appears beside a bubble on hover, or on tap for
 * touch devices which have no hover.
 *
 * One icon rather than the whole quick row: a row of seven emoji floating next
 * to every message was noise, and it was wide enough to overflow on a phone.
 * The quick row lives behind this, the way WhatsApp does it.
 */
export const ReactionTrigger: React.FC<ReactionTriggerProps> = ({
  onReact,
  myReaction,
  disabled,
  onMore,
}) => {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-label="React to this message"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => {
          // Keep it from reaching the bubble's own tap handler, which would
          // toggle the toolbar shut again.
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-ink/5 text-ink/40 transition-colors hover:bg-ink/10 hover:text-ink"
      >
        <FaceSmileIcon className="h-4 w-4" />
      </button>

      {open && anchor ? (
        <ReactionPickerPopover
          anchor={anchor}
          onClose={() => setOpen(false)}
          onReact={onReact}
          myReaction={myReaction}
          onMore={onMore}
        />
      ) : null}
    </>
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
            group.includesMe
              ? `You reacted ${group.emoji} — click to remove it`
              : group.names.length > 0
                ? group.names.join(", ")
                : `${group.count} reaction${group.count === 1 ? "" : "s"}`
          }
          onClick={(e) => {
            e.stopPropagation();
            // Only the current user's own reaction is toggleable.
            if (group.includesMe) onReact(group.emoji);
          }}
          className={classNames(
            // `group` is what the removal badge keys its hover state off.
            "group relative inline-flex items-center gap-1 border-2 px-1.5 py-0.5 text-xs leading-none transition-colors",
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
          {/* Removal affordance. Clicking your own reaction already removed it,
              but nothing said so — the chip looked the same as everyone else's. */}
          {group.includesMe ? (
            <span
              aria-hidden="true"
              className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border-2 border-ink bg-retro-red text-paper group-hover:flex"
            >
              <XMarkIcon className="h-2.5 w-2.5" />
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
};

export default ReactionTrigger;
