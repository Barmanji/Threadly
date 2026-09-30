import { FaceSmileIcon, PlusIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MessageReactionInterface } from "../../interfaces/chat";
import { classNames } from "../../utils";
import { REACTION_UI_ATTR } from "../../utils/reactionUi";
import { QUICK_REACTIONS } from "./reactionEmojis";

interface ReactionGroup {
  emoji: string;
  count: number;
  names: string[];
  /** Avatar per reactor, in the same order as `names`. May contain gaps. */
  avatars: string[];
  includesMe: boolean;
}

/**
 * Collapse a flat reaction list into one entry per emoji.
 *
 * Reactions arrive newest-last and may repeat the same emoji across several
 * participants, so they have to be grouped and counted before rendering.
 * Group order follows first appearance, which keeps a bubble's chips stable
 * instead of reshuffling as people react.
 *
 * The reactor's id lives in `reaction.user` and the resolved profile in the
 * sibling `username`/`avatar` fields — see MessageReactionInterface. Matching on
 * `user` (not a nested `user._id`, which is undefined here) is what lets the
 * page tell that you are one of the reactors, which is what turns your own
 * chip yellow and makes clicking it remove the reaction.
 */
export const groupReactions = (
  reactions: MessageReactionInterface[] | undefined,
  myUserId: string | undefined,
): ReactionGroup[] => {
  const groups = new Map<string, ReactionGroup>();

  for (const reaction of reactions ?? []) {
    const reactorId = String(reaction.user ?? "");
    const reactorName = reaction.username ?? "";
    const reactorAvatar = reaction.avatar ?? "";

    const existing = groups.get(reaction.emoji);

    if (existing) {
      existing.count += 1;
      existing.avatars.push(reactorAvatar);

      if (reactorName) {
        existing.names.push(reactorName);
      }

      if (reactorId && reactorId === String(myUserId)) {
        existing.includesMe = true;
      }
    } else {
      groups.set(reaction.emoji, {
        emoji: reaction.emoji,
        count: 1,
        names: reactorName ? [reactorName] : [],
        avatars: [reactorAvatar],
        includesMe: Boolean(reactorId && reactorId === String(myUserId)),
      });
    }
  }

  return [...groups.values()];
};

const POPOVER_WIDTH = 264;
const VIEWPORT_MARGIN = 8;

const ReactionPickerPopover: React.FC<{
  anchor: HTMLElement;
  onReact: (emoji: string) => void;
  onClose: () => void;
  myReaction: string | null;
  onMore: (
    e: React.MouseEvent<HTMLButtonElement>,
  ) => void;
}> = ({
  anchor,
  onReact,
  onClose,
  myReaction,
  onMore,
}) => {
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const panelRef =
    useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const place = () => {
      const rect =
        anchor.getBoundingClientRect();

      const panel = panelRef.current;
      const height =
        panel?.offsetHeight ?? 48;

      let left =
        rect.left +
        rect.width / 2 -
        POPOVER_WIDTH / 2;

      let top =
        rect.top -
        height -
        VIEWPORT_MARGIN;

      if (top < VIEWPORT_MARGIN) {
        top =
          rect.bottom +
          VIEWPORT_MARGIN;
      }

      left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(
          left,
          window.innerWidth -
            POPOVER_WIDTH -
            VIEWPORT_MARGIN,
        ),
      );

      setCoords({
        left,
        top,
      });
    };

    place();

    window.addEventListener(
      "resize",
      place,
    );

    window.addEventListener(
      "scroll",
      place,
      true,
    );

    return () => {
      window.removeEventListener(
        "resize",
        place,
      );

      window.removeEventListener(
        "scroll",
        place,
        true,
      );
    };
  }, [anchor]);

  useEffect(() => {
    const onPointerDown = (
      e: PointerEvent,
    ) => {
      if (
        panelRef.current?.contains(
          e.target as Node,
        )
      ) {
        return;
      }

      if (
        anchor.contains(
          e.target as Node,
        )
      ) {
        return;
      }

      onClose();
    };

    const onKeyDown = (
      e: KeyboardEvent,
    ) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener(
      "pointerdown",
      onPointerDown,
    );

    document.addEventListener(
      "keydown",
      onKeyDown,
    );

    return () => {
      document.removeEventListener(
        "pointerdown",
        onPointerDown,
      );

      document.removeEventListener(
        "keydown",
        onKeyDown,
      );
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="React to this message"
      {...{ [REACTION_UI_ATTR]: "" }}
      className="
        neo-sm
        fixed
        z-[100]
        flex
        items-center
        gap-0.5
        bg-paper
        p-1
      "
      style={{
        width: POPOVER_WIDTH,
        ...(coords ?? {
          left: -9999,
          top: -9999,
        }),
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
            `
              flex
              h-8
              w-8
              items-center
              justify-center
              rounded-sm
              text-lg
              transition-transform
              hover:scale-125
              focus:scale-125
              focus:outline-none
            `,
            // Without this a quick second tap anywhere on the page is
            // eligible to be read as a double-tap zoom, and the browser
            // withholds the click while it decides. See the same class on
            // ReactionTrigger, which is where that actually bit us.
            "touch-manipulation",
            myReaction === emoji
              ? "bg-retro-yellow"
              : "",
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
        className="
          flex
          h-8
          w-8
          items-center
          justify-center
          rounded-sm
          text-ink/50
          transition-colors
          touch-manipulation
          hover:bg-ink/10
          hover:text-ink
        "
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>,
    document.body,
  );
};

interface ReactionTriggerProps {
  onReact: (emoji: string) => void;
  myReaction: string | null;
  disabled?: boolean;
  onMore: (
    e: React.MouseEvent<HTMLButtonElement>,
  ) => void;
}

export const ReactionTrigger: React.FC<
  ReactionTriggerProps
> = ({
  onReact,
  myReaction,
  disabled,
  onMore,
}) => {
  const [open, setOpen] =
    useState(false);

  const [anchor, setAnchor] =
    useState<HTMLButtonElement | null>(
      null,
    );

  return (
    <>
      <button
        ref={setAnchor}
        type="button"
        aria-label="React to this message"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="
          flex
          h-8
          w-8
          flex-shrink-0
          items-center
          justify-center
          rounded-full
          border-2
          border-ink
          bg-paper
          text-ink/60
          shadow-[2px_2px_0_0_var(--color-ink)]
          transition-colors
          touch-manipulation
          hover:bg-retro-yellow
          hover:text-ink
        "
      >
        <FaceSmileIcon className="h-4 w-4" />
      </button>

      {open && anchor ? (
        <ReactionPickerPopover
          anchor={anchor}
          onClose={() =>
            setOpen(false)
          }
          onReact={onReact}
          myReaction={myReaction}
          onMore={onMore}
        />
      ) : null}
    </>
  );
};

interface ReactorTooltipProps {
  anchor: HTMLElement;
  group: ReactionGroup;
  myUserId: string | undefined;
}

/** "Alice", "Alice and Bob", "Alice, Bob and 3 others". */
const summarise = (names: string[], count: number): string => {
  if (names.length === 0) {
    return `${count} ${count === 1 ? "person" : "people"} reacted`;
  }
  if (count === 1) return names[0] ?? "";
  if (names.length === 1) return `${names[0]} and 1 other`;
  if (names.length === 2)
    return `${names[0]} and ${names[1]}`.trim();
  return `${names[0]}, ${names[1]} and ${count - 2} ${
    count - 2 === 1 ? "other" : "others"
  }`;
};

/**
 * Who reacted, shown as a real panel rather than a `title` attribute.
 *
 * A native title is unusable here: it never appears on a touch device at all,
 * it takes about a second to fade in, it can't be styled, and in a group chat
 * the comma-joined list it shows is long enough to be clipped at the window
 * edge. This is portalled for the same reason the picker is — the message
 * bubble clips its own overflow in some layouts, so an in-flow tooltip would
 * get cut off.
 */
const ReactorTooltip: React.FC<ReactorTooltipProps> = ({
  anchor,
  group,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{
    left: number;
    top: number;
  } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const width = panelRef.current?.offsetWidth ?? 200;
      const height = panelRef.current?.offsetHeight ?? 40;

      const left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(
          rect.left + rect.width / 2 - width / 2,
          window.innerWidth - width - VIEWPORT_MARGIN,
        ),
      );

      // Prefer above the chip; flip under it when there's no room.
      let top = rect.top - height - VIEWPORT_MARGIN;
      if (top < VIEWPORT_MARGIN) top = rect.bottom + VIEWPORT_MARGIN;

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

  const rows = group.names.length
    ? group.names.map((name, i) => ({ name, avatar: group.avatars[i] ?? "" }))
    : [{ name: "Someone", avatar: "" }];

  return createPortal(
    <div
      ref={panelRef}
      role="tooltip"
      className="neo-sm pointer-events-none fixed z-[110] max-w-[240px] bg-paper px-3 py-2"
      style={coords ?? { left: -9999, top: -9999 }}
    >
      <p className="text-[11px] font-extrabold uppercase tracking-wide text-ink">
        {summarise(group.names, group.count)} reacted {group.emoji}
      </p>

      {/* Long lists get a scroll rather than growing off the screen. */}
      <div className="mt-1.5 flex max-h-40 flex-col gap-1 overflow-y-auto">
        {rows.map((row, i) => (
          <div key={`${row.name}-${i}`} className="flex items-center gap-2">
            {row.avatar ? (
              <img
                src={row.avatar}
                alt=""
                className="h-5 w-5 flex-shrink-0 rounded-full border border-ink object-cover"
              />
            ) : (
              <span className="h-5 w-5 flex-shrink-0 rounded-full border border-ink bg-ink/10" />
            )}
            <span className="truncate text-xs text-ink">{row.name}</span>
          </div>
        ))}
      </div>

      {group.includesMe ? (
        <p className="mt-1.5 border-t-2 border-ink/15 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-ink/60">
          Tap to remove yours
        </p>
      ) : null}
    </div>,
    document.body,
  );
};

interface ReactionChipsProps {
  reactions:
    | MessageReactionInterface[]
    | undefined;
  myUserId: string | undefined;
  onReact: (emoji: string) => void;
  disabled?: boolean;
}

export const ReactionChips: React.FC<
  ReactionChipsProps
> = ({
  reactions,
  myUserId,
  onReact,
  disabled,
}) => {
  const groups = groupReactions(
    reactions,
    myUserId,
  );

  // Which chip's tooltip is open, and the element to anchor it to.
  const [openFor, setOpenFor] = useState<{
    emoji: string;
    anchor: HTMLElement;
  } | null>(null);

  // A long press has to beat the browser's own gesture handling: the native
  // context menu and text selection would otherwise fire first. `preventDefault`
  // on the timer firing stops the click that follows from toggling the
  // reaction, which is what separates "peek at who reacted" from "remove mine".
  const pressTimer = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const pressAnchor = useRef<{
    emoji: string;
    anchor: HTMLElement;
  } | null>(null);

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressAnchor.current = null;
  };

  useEffect(() => clearPress, []);

  // A tooltip that's open while the list re-renders (someone else reacted, or
  // this one was removed) has nothing left to point at.
  useEffect(() => {
    if (
      openFor &&
      !groups.some((g) => g.emoji === openFor.emoji)
    ) {
      setOpenFor(null);
    }
  }, [groups, openFor]);

  const startPress = (
    e: React.PointerEvent<HTMLButtonElement>,
    emoji: string,
  ) => {
    if (e.pointerType === "mouse") return;
    clearPress();
    pressAnchor.current = { emoji, anchor: e.currentTarget };
    pressTimer.current = setTimeout(() => {
      const target = pressAnchor.current;
      pressTimer.current = null;
      pressAnchor.current = null;
      if (target) setOpenFor(target);
    }, 450);
  };

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {groups.map((group) => (
        <button
          key={group.emoji}
          type="button"
          disabled={disabled}
          // No `title` on purpose — the real tooltip below replaces it, and
          // two tooltips on one element is worse than one.
          aria-label={`${group.count} ${group.count === 1 ? "reaction" : "reactions"} ${group.emoji}${
            group.includesMe ? " — tap to remove yours" : ""
          }`}
          onPointerEnter={(e) => {
            if (e.pointerType !== "mouse") return;
            setOpenFor({
              emoji: group.emoji,
              anchor: e.currentTarget,
            });
          }}
          onPointerLeave={(e) => {
            if (e.pointerType !== "mouse") return;
            setOpenFor((prev) =>
              prev?.emoji === group.emoji ? null : prev,
            );
          }}
          onPointerDown={(e) =>
            startPress(e, group.emoji)
          }
          onPointerUp={clearPress}
          onPointerCancel={clearPress}
          onContextMenu={(e) => {
            // A long press already opened the tooltip; don't also let the OS
            // menu pop up behind it.
            if (pressAnchor.current) e.preventDefault();
          }}
          onClick={(e) => {
            e.stopPropagation();

            if (pressTimer.current) clearPress();

            if (group.includesMe) {
              setOpenFor(null);
              onReact(group.emoji);
            } else if (
              openFor?.emoji !== group.emoji
            ) {
              // Tapping someone else's reaction still tells you who, since
              // there's no hover on a touch screen to fall back on.
              setOpenFor({
                emoji: group.emoji,
                anchor: e.currentTarget,
              });
            } else {
              setOpenFor(null);
            }
          }}
          className={classNames(
            `
              group
              relative
              inline-flex
              touch-manipulation
              items-center
              gap-1
              border-2
              px-1.5
              py-0.5
              text-xs
              leading-none
              transition-colors
            `,
            group.includesMe
              ? "cursor-pointer border-ink bg-retro-yellow"
              : "cursor-pointer border-ink/30 bg-ink/5",
            disabled
              ? "cursor-not-allowed opacity-60"
              : "",
          )}
        >
          <span aria-hidden="true">
            {group.emoji}
          </span>

          {group.count > 1 ? (
            <span className="font-bold tabular-nums">
              {group.count}
            </span>
          ) : null}

          {group.includesMe ? (
            <span
              aria-hidden="true"
              className="
                absolute
                -right-1.5
                -top-1.5
                hidden
                h-4
                w-4
                items-center
                justify-center
                rounded-full
                border-2
                border-ink
                bg-retro-red
                text-paper
                group-hover:flex
                group-focus-visible:flex
              "
            >
              <XMarkIcon className="h-2.5 w-2.5" />
            </span>
          ) : null}
        </button>
      ))}

      {openFor
        ? (() => {
            const group = groups.find(
              (g) => g.emoji === openFor.emoji,
            );
            return group ? (
              <ReactorTooltip
                anchor={openFor.anchor}
                group={group}
                myUserId={myUserId}
              />
            ) : null;
          })()
        : null}
    </div>
  );
};

export default ReactionTrigger;
