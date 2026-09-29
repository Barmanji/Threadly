import { FaceSmileIcon, MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/20/solid";
import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  EMOJI_SECTIONS,
  type EmojiEntry,
  type EmojiSection,
} from "./reactionEmojis";
import { classNames } from "../../utils";

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

  // Close on an outside pointer-down or Escape.
  useLayoutEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (anchor?.contains(e.target as Node)) return;
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
        <div className="flex gap-1 overflow-x-auto border-b-[3px] border-ink p-2">
          {EMOJI_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => scrollToSection(section.id)}
              className={classNames(
                "neo-sm flex-shrink-0 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide transition-colors",
                activeSection === section.id
                  ? "bg-retro-yellow text-ink"
                  : "bg-cream text-ink/60 hover:text-ink",
              )}
            >
              {section.label}
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
