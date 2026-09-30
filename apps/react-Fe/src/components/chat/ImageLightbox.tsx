import { XMarkIcon } from "@heroicons/react/20/solid";
import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Full-screen viewer for an image attached to a message.
 *
 * This used to be an `absolute inset-0` div rendered inside the message row, so
 * it was laid out by the message it belonged to and covered only that row:
 *
 *   - The message list renders newest-first inside a `flex-col-reverse`
 *     column, so an old image's viewer opened wherever that message sat in the
 *     scroll — far from the user, who then had to scroll back to find it.
 *   - Because it was bounded by the bubble, the "enlarged" image was barely
 *     larger than the thumbnail.
 *
 * `createPortal` onto `document.body` puts it in the viewport's coordinate
 * space instead, so it opens where the user is regardless of scroll position —
 * the same escape hatch the reaction popovers and the emoji picker already use.
 * `z-[120]` clears the tallest of those (`z-[110]`).
 */
const ImageLightbox: React.FC<{
    src: string;
    onClose: () => void;
}> = ({ src, onClose }) => {
    // Escape closes. Bound to `window` rather than the overlay so the key is
    // caught wherever focus currently sits.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };

        window.addEventListener("keydown", onKeyDown);

        return () =>
            window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Enlarged image"
            // Only a tap that lands on the scrim itself closes. Comparing the
            // two rather than stopping propagation keeps a tap on the image
            // from closing the thing the user just opened.
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
            /*
             * `bg-ink` instead of a hard-coded black so the scrim follows the
             * palette: `--ink` is near-black in both themes, so a photo reads
             * the same over it either way and no new colour token is needed.
             * The close glyph is `text-paper`, which is pale in both themes
             * and so keeps its contrast against that scrim.
             *
             * `touch-none` matters on a phone: the message list is its own
             * scroll container, so a fixed overlay does not by itself catch a
             * swipe that starts on it — without this, dragging the scrim
             * scrolls the chat behind the open image.
             */
            className="fixed inset-0 z-[120] flex touch-none items-center justify-center overflow-hidden bg-ink/90 p-4 sm:p-8"
        >
            <button
                type="button"
                onClick={onClose}
                aria-label="Close enlarged image"
                className="absolute right-3 top-3 flex h-11 w-11 cursor-pointer items-center justify-center rounded-sm text-paper transition-opacity hover:opacity-70 sm:right-5 sm:top-5"
            >
                <XMarkIcon className="h-8 w-8" />
            </button>

            <img
                src={src}
                alt="chat image"
                className="max-h-full max-w-full object-contain"
            />
        </div>,
        document.body,
    );
};

export default ImageLightbox;
