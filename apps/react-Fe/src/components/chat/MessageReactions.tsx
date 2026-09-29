import { PlusIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useEffect, useRef, useState } from "react";
import type { MessageReactionInterface } from "../../interfaces/chat";
import { classNames } from "../../utils";
import EmojiPicker from "./EmojiPicker";
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

interface ReactionPickerProps {
  onReact: (emoji: string) => void;
  /** The current user's existing reaction, highlighted in the picker. */
  myReaction: string | null;
  disabled?: boolean;
}

/**
 * The quick reaction row, plus the full picker behind a "+".
 *
 * This is the hover toolbar that floats over a bubble — it is not rendered
 * inline in the message footer, because a permanently-visible smiley button on
 * every message is noise. See `MessageItem` for the hover wiring.
 */
const ReactionPicker: React.FC<ReactionPickerProps> = ({
  onReact,
  myReaction,
  disabled,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the full picker on an outside click or Escape. The quick row itself
  // is a hover surface and closes on mouse-out; the picker is a dialog and
  // needs an explicit way out.
  useEffect(() => {
    if (!pickerOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setPickerOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerOpen]);

  const togglePicker = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Remember the trigger so the picker can position against it.
    setAnchor(e.currentTarget);
    setPickerOpen((prev) => !prev);
  };

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={classNames(
          "neo-sm flex items-center gap-0.5 bg-paper p-1",
          disabled ? "pointer-events-none opacity-50" : "",
        )}
      >
        {QUICK_REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            title={`React with ${emoji}`}
            onClick={() => onReact(emoji)}
            className={classNames(
              "flex h-7 w-7 items-center justify-center rounded-sm text-base transition-transform hover:scale-125 focus:scale-125 focus:outline-none",
              myReaction === emoji ? "bg-retro-yellow" : "",
            )}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          onClick={togglePicker}
          aria-label="More emoji"
          aria-expanded={pickerOpen}
          title="More emoji"
          className="flex h-7 w-7 items-center justify-center rounded-sm text-ink/50 transition-colors hover:bg-ink/10 hover:text-ink"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>

      {pickerOpen && anchor ? (
        <EmojiPicker
          anchor={anchor}
          onClose={() => setPickerOpen(false)}
          onPick={(emoji) => {
            onReact(emoji);
            setPickerOpen(false);
          }}
          myReaction={myReaction}
        />
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

export default ReactionPicker;
