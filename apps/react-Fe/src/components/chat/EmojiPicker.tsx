import { FaceSmileIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  EMOJI_SECTIONS,
  type EmojiEntry,
  type EmojiSection,
} from "./reactionEmojis";
import { classNames } from "../../utils";
import { REACTION_UI_ATTR } from "../../utils/reactionUi";

interface EmojiPickerProps {
  /** Called with the chosen emoji. */
  onPick: (emoji: string) => void;
  onClose: () => void;
  /** The element to position against — the button that opened the picker. */
  anchor: HTMLElement | null;
  /** Opens above the anchor by default; below when there isn't room. */
  placement?: "top" | "bottom";
  /** The current user's reaction, highlighted in the grid. */
  myReaction?: string | null;
}

const PICKER_WIDTH = 320;
const PICKER_MAX_HEIGHT = 380;
const VIEWPORT_MARGIN = 8;

/**
 * Short labels for the category tabs.
 *
 * The section `label`s are the full CLDR names ("Smileys & Emotion"), which are
 * right for the heading above each list but hopeless as tab text: at 10px in a
 * 320px panel, nine of them overflowed a horizontally scrolling row, so most
 * tabs sat off-screen and the visible ones were ~18px tall — too small to hit.
 *
 * These are display-only. The tab keeps the full `label` as its accessible name
 * via `aria-label`, and the heading inside the list still shows the full name, so
 * nothing is lost. Keyed by section id with a fallback to the full label, so a
 * section added to the generated data file still renders a usable tab instead of
 * `undefined`.
 */
const TAB_LABELS: Record<string, string> = {
  smileys: "Smileys",
  people: "People",
  animals: "Animals",
  food: "Food",
  travel: "Places",
  activities: "Fun",
  objects: "Objects",
  symbols: "Symbols",
  flags: "Flags",
};

/**
 * The full emoji picker: search plus the CLDR sections.
 *
 * Rendered through a portal with `position: fixed` rather than in place. The
 * message list is `overflow-y-auto`, so an in-place popover anchored to a bubble
 * near the top of the viewport gets clipped the moment it opens upward — the
 * same problem the reaction picker had, at a larger size.
 */
const EmojiPicker: React.FC<EmojiPickerProps> = ({
  onPick,
  onClose,
  anchor,
  placement = "top",
  myReaction,
}) => {
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState<string>(
    EMOJI_SECTIONS[0]?.id ?? "",
  );
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(
    null,
  );
  const panelRef = useRef<HTMLDivElement>(null);

  // Position against the anchor's live rect. Recomputed on scroll and resize
  // because the message list scrolls under a `position: fixed` popover, which
  // would otherwise drift away from the button that opened it.
  useLayoutEffect(() => {
    if (!anchor) return;

    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const panel = panelRef.current;
      const height = panel?.offsetHeight ?? PICKER_MAX_HEIGHT;

      // Right-align with the anchor so a right-side trigger doesn't push the
      // panel off the right edge of the screen.
      let left = rect.right - PICKER_WIDTH;
      let top =
        placement === "top"
          ? rect.top - height - VIEWPORT_MARGIN
          : rect.bottom + VIEWPORT_MARGIN;

      // Flip below when there isn't room above, and vice versa.
      if (top < VIEWPORT_MARGIN) {
        top = rect.bottom + VIEWPORT_MARGIN;
      }
      if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
        top = Math.max(VIEWPORT_MARGIN, rect.top - height - VIEWPORT_MARGIN);
      }

      left = Math.max(
        VIEWPORT_MARGIN,
        Math.min(left, window.innerWidth - PICKER_WIDTH - VIEWPORT_MARGIN),
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
  }, [anchor, placement]);

  // Close on an outside pointer-down, on typing into another field, or Escape.
  useLayoutEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (anchor?.contains(e.target as Node)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // Typing in the chat composer (or any other field outside the picker)
      // dismisses it. Without this the picker stayed open over the composer
      // while the user was writing a message, which is the opposite of what
      // picking an emoji is for. The picker's own search box is inside the
      // panel, so it is excluded and keeps working.
      if (panelRef.current?.contains(e.target as Node)) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      const isEditable =
        tag === "TEXTAREA" ||
        tag === "INPUT" ||
        el?.isContentEditable === true;
      if (isEditable) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);

  const trimmed = query.trim().toLowerCase();

  // A query flattens the sections into one result list; otherwise the sections
  // render under their own headings.
  const visible: EmojiSection[] = trimmed
    ? [
        {
          id: "search",
          label: "Results",
          emojis: EMOJI_SECTIONS.flatMap((s) =>
            s.emojis.filter(
              (e) =>
                e.label.toLowerCase().includes(trimmed) ||
                e.keywords.some((k) => k.includes(trimmed)),
            ),
          ),
        },
      ]
    : EMOJI_SECTIONS;

  const flatVisible = visible.flatMap((s) => s.emojis);

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    panelRef.current
      ?.querySelector(`[data-section="${id}"]`)
      ?.scrollIntoView({ block: "start" });
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Emoji picker"
      {...{ [REACTION_UI_ATTR]: "" }}
      className="neo fixed z-[100] flex flex-col bg-paper"
      style={{
        width: PICKER_WIDTH,
        maxHeight: PICKER_MAX_HEIGHT,
        ...(coords ?? { left: -9999, top: -9999 }),
      }}
    >
      <div className="flex items-center gap-2 border-b-[3px] border-ink p-2">
        <div className="neo-sm flex flex-1 items-center gap-1.5 bg-cream px-2">
          <MagnifyingGlassIcon className="h-4 w-4 flex-shrink-0 text-ink/50" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search emoji"
            aria-label="Search emoji"
            autoFocus
            className="w-full bg-transparent py-1.5 text-xs font-semibold text-ink placeholder:text-ink/40 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-ink/50 hover:text-ink"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close emoji picker"
          className="neo-sm neo-press flex h-8 w-8 flex-shrink-0 items-center justify-center bg-cream text-ink"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>

      {/* Section tabs. Hidden while searching, since the results are one list. */}
      {trimmed ? null : (
        <div className="flex flex-none gap-1.5 overflow-x-auto overscroll-x-contain border-b-[3px] border-ink p-2 pb-3.5 [scrollbar-width:thin]">
          {EMOJI_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => scrollToSection(section.id)}
              aria-label={section.label}
              aria-current={activeSection === section.id}
              className={classNames(
                // One row that slides sideways. Wrapping onto two or three rows
                // cost ~90px of the picker's 380px budget, which is a lot of
                // emoji grid not shown.
                //
                // `flex-none` on each tab is load-bearing: in an
                // `overflow-x-auto` flex row, items shrink by default instead of
                // overflowing, so without it the nine tabs squash to fit and
                // never scroll at all.
                //
                // `min-h-11` makes the bar 44px, a full-size touch target,
                // because `px-2 py-1 text-[10px]` rendered an ~18px sliver that
                // was hard to see and harder to tap. Raising this to 200px did
                // not help and that was the real tell: the row itself was being
                // squashed, so `min-h` on the buttons had nothing to grow into.
                // The parent above now carries `flex-none` plus the bottom
                // padding the 3px `neo-sm` shadow needs.
                "neo-sm flex min-h-9 flex-none items-center justify-center px-3.5 py-2 text-xs font-extrabold uppercase tracking-wide transition-colors",
                activeSection === section.id
                  ? "bg-retro-yellow text-ink"
                  : "bg-cream text-ink/60 hover:text-ink",
              )}
            >
              {TAB_LABELS[section.id] ?? section.label}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {flatVisible.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <FaceSmileIcon className="h-8 w-8 text-ink/30" />
            <p className="text-xs font-bold text-ink/50">
              No emoji match {query ? `"${query}"` : ""}.
            </p>
          </div>
        ) : (
          visible.map((section) => (
            <div key={section.id} data-section={section.id}>
              {trimmed ? null : (
                <p className="sticky top-0 z-10 bg-paper pb-1 pt-1 text-[10px] font-extrabold uppercase tracking-widest text-ink/50">
                  {section.label}
                </p>
              )}
              <div className="grid grid-cols-7 gap-0.5 pb-3">
                {section.emojis.map((entry: EmojiEntry) => (
                  <button
                    key={entry.emoji}
                    type="button"
                    title={entry.label}
                    onClick={() => onPick(entry.emoji)}
                    className={classNames(
                      "flex h-9 items-center justify-center rounded-sm text-xl transition-transform hover:scale-125 focus:scale-125 focus:outline-none",
                      myReaction === entry.emoji ? "bg-retro-yellow" : "",
                    )}
                  >
                    {entry.emoji}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
};

export default EmojiPicker;
