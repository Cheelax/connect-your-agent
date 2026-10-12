// The agents catalogue and the link builder: see ARCHITECTURE.md.

/** @typedef {"url" | "deeplink" | "command"} Kind */
/** @typedef {{ id: string, name: string, kind: Kind, prefix: string }} Agent */
/** @typedef {{ agent: string, kind: Kind, value: string }} Link */

/** Every agent the button offers, in display order. */
export const agents = /** @type {Agent[]} */ ([
  { id: "claude", name: "Claude", kind: "url", prefix: "https://claude.ai/new?q=" },
  { id: "chatgpt", name: "ChatGPT", kind: "url", prefix: "https://chatgpt.com/?q=" },
  { id: "perplexity", name: "Perplexity", kind: "url", prefix: "https://www.perplexity.ai/search?q=" },
  { id: "le-chat", name: "Le Chat", kind: "url", prefix: "https://chat.mistral.ai/chat?q=" },
  { id: "cursor", name: "Cursor", kind: "deeplink", prefix: "cursor://anysphere.cursor-deeplink/prompt?text=" },
  { id: "claude-code", name: "Claude Code", kind: "command", prefix: "claude " },
  { id: "codex", name: "Codex CLI", kind: "command", prefix: "codex " },
]);

/** The longest `url` or `deeplink` value, in characters. Commands have no limit. */
export const MAX_LINK_LENGTH = 8000;

/**
 * Creates an error that callers can handle without matching its message.
 * @param {"UNKNOWN_AGENT" | "EMPTY_PROMPT" | "TOO_LONG"} code
 * @param {string} message
 */
function linkError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Quotes a string as one POSIX shell word. */
function quoteForShell(prompt) {
  return `'${prompt.replaceAll("'", "'\\''")}'`;
}

/**
 * The link that opens agent `id` with `prompt` already pasted.
 * @param {string} id
 * @param {string} prompt
 * @returns {Link}
 */
export function linkFor(id, prompt) {
  const selected = agents.find((agent) => agent.id === id);
  if (!selected) {
    throw linkError("UNKNOWN_AGENT", `Unknown agent ${JSON.stringify(id)}.`);
  }

  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw linkError("EMPTY_PROMPT", "The prompt must contain at least one non-whitespace character.");
  }

  const value = selected.prefix + (selected.kind === "command" ? quoteForShell(prompt) : encodeURIComponent(prompt));
  if (selected.kind !== "command" && value.length > MAX_LINK_LENGTH) {
    throw linkError("TOO_LONG", `The ${selected.kind} is ${value.length} characters; the limit is ${MAX_LINK_LENGTH}.`);
  }

  return { agent: selected.id, kind: selected.kind, value };
}
