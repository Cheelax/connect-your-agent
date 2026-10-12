// The agents catalogue and the link builder: see ARCHITECTURE.md.
// Round 1 ("The core") fills this file in.

/** @typedef {"url" | "deeplink" | "command"} Kind */
/** @typedef {{ id: string, name: string, kind: Kind }} Agent */
/** @typedef {{ agent: string, kind: Kind, value: string }} Link */

/** Every agent the button offers, in display order. */
export const agents = /** @type {Agent[]} */ ([]);

/** The longest `url` or `deeplink` value, in characters. Commands have no limit. */
export const MAX_LINK_LENGTH = 8000;

/**
 * The link that opens agent `id` with `prompt` already pasted.
 * @param {string} id
 * @param {string} prompt
 * @returns {Link}
 */
export function linkFor(id, prompt) {
  throw new Error("not implemented");
}
