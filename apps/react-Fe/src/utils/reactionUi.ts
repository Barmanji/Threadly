/**
 * Markers for the message-reaction flow.
 *
 * Kept in its own module rather than in `utils/index.ts` or in
 * `MessageReactions.tsx` because three separate component files need it and
 * none of them should have to import from another component module to get it.
 */

/**
 * Marks every element that belongs to the reaction flow — the trigger, the
 * quick-reaction bar, and the full picker.
 *
 * The two popovers are rendered through `createPortal` onto `document.body`,
 * so the message row can never reach them by DOM containment: they are
 * siblings of the entire chat page, not descendants of the bubble. That
 * breaks any "was this tap inside us?" check written with `contains()`.
 * A marker attribute makes the same check work off `closest()`, wherever the
 * element happens to live in the tree.
 */
export const REACTION_UI_ATTR = "data-reaction-ui";

/** True when `target` is the reaction trigger or either reaction popover. */
export const isReactionUi = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(`[${REACTION_UI_ATTR}]`));
};