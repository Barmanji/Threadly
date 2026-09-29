import { Toaster } from "sonner";
import { useIsMobile } from "../hooks/useIsMobile";

/**
 * The toast position is nudged to the middle of the chat pane rather than the
 * middle of the window, because the sidebar takes up the left third on desktop
 * and a centred toast would land on top of the chat list.
 *
 * That's a computed pixel offset though, so it can't be a media query in the
 * class name — and Sonner writes its own positioning inline, which would win
 * over any class. Hence the hook.
 *
 * On a phone the sidebar is either full-width or hidden, so the visible pane
 * spans the whole screen and 50% is correct either way.
 */
const ChatToaster: React.FC = () => {
  const isMobile = useIsMobile();

  return (
    <Toaster
      position="top-center"
      style={{
        left: isMobile ? "50%" : "66.67%",
        transform: "translateX(-50%)",
      }}
      toastOptions={{
        className: "neo-sm border-ink! bg-cream! text-ink! font-semibold",
      }}
    />
  );
};

export default ChatToaster;
