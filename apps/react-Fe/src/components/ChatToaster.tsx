import { Toaster } from "sonner";

/**
 * Toasts should sit over whatever the user is actually looking at.
 *
 * On the chat page that's the conversation, not the window: the sidebar takes
 * the left third, so a window-centred toast lands on the chat list. It used to
 * hardcode `66.67%` — the centre of a one-third sidebar plus a two-thirds chat —
 * which was wrong twice over. On the auth pages there is no sidebar at all, so
 * the wrong-password toast appeared two-thirds across the screen; and on the
 * chat page the sidebar is draggable, so the offset drifted the moment you
 * resized it.
 *
 * Rather than a route check, the chat page publishes its real sidebar width as
 * a custom property and the offset is derived from it. Any route without the
 * chat layout leaves the property unset, which reads as `0` and centres the
 * toast on the window. That keeps it correct on login and register, on mobile
 * (where the visible pane is full width either way), and after a resize.
 *
 * It's still a pixel value rather than a class, because Sonner writes its own
 * positioning inline and that would win over any class we set.
 */
const ChatToaster: React.FC = () => (
  <Toaster
    position="top-center"
    style={{
      left:
        "calc(var(--sidebar-w, 0px) + (100vw - var(--sidebar-w, 0px)) / 2)",
      transform: "translateX(-50%)",
    }}
    toastOptions={{
      className: "neo-sm border-ink! bg-cream! text-ink! font-semibold",
    }}
  />
);

export default ChatToaster;
