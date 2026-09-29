import { useEffect, useState } from "react";

/**
 * Matches Tailwind's `md` breakpoint (768px) so this and the stylesheet always
 * agree on what counts as a phone — the layout switches on one boundary, not
 * two that can drift apart.
 */
const MOBILE_QUERY = "(max-width: 767.98px)";

const matches = (): boolean =>
  typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches;

/**
 * True while the viewport is phone-sized.
 *
 * This drives layout decisions that CSS alone can't express, mostly because
 * they need state: whether the chat list or the conversation is showing. The
 * stylesheet handles the visual half; this handles the "which screen am I on"
 * half.
 */
export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState<boolean>(matches);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    // Re-read on mount: the breakpoint may have been crossed between the first
    // render and this effect (e.g. an orientation change while loading).
    setIsMobile(query.matches);

    const onChange = (event: MediaQueryListEvent) =>
      setIsMobile(event.matches);

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return isMobile;
};
