// The agents catalogue and the link builder: see ARCHITECTURE.md.
// No Node built-ins here: the <connect-agent> button imports this file in the browser.

/** @typedef {"url" | "deeplink" | "command"} Kind */
/** @typedef {{ id: string, name: string, kind: Kind, prefix: string }} Agent */
/** @typedef {{ agent: string, kind: Kind, value: string }} Link */

/**
 * Every agent the button offers, in display order. Adding an agent is one entry here: its value is
 * `prefix` followed by the prompt, URL-encoded for a `url` or a `deeplink`, single-quoted for a `command`.
 */
export const agents = /** @type {readonly Agent[]} */ (
  Object.freeze(
    [
      { id: "claude", name: "Claude", kind: "url", prefix: "https://claude.ai/new?q=" },
      { id: "chatgpt", name: "ChatGPT", kind: "url", prefix: "https://chatgpt.com/?q=" },
      { id: "perplexity", name: "Perplexity", kind: "url", prefix: "https://www.perplexity.ai/search?q=" },
      { id: "le-chat", name: "Le Chat", kind: "url", prefix: "https://chat.mistral.ai/chat?q=" },
      { id: "cursor", name: "Cursor", kind: "deeplink", prefix: "cursor://anysphere.cursor-deeplink/prompt?text=" },
      { id: "claude-code", name: "Claude Code", kind: "command", prefix: "claude " },
      { id: "codex", name: "Codex CLI", kind: "command", prefix: "codex " },
    ].map((agent) => Object.freeze(agent)),
  )
);

/** The longest `url` or `deeplink` value, in characters. Commands have no limit. */
export const MAX_LINK_LENGTH = 8000;

/** How each kind carries the prompt. */
const carry = {
  url: (prompt) => encodeURIComponent(prompt),
  deeplink: (prompt) => encodeURIComponent(prompt),
  // One argument for a POSIX shell: inside single quotes nothing is special but the quote itself.
  command: (prompt) => `'${prompt.replaceAll("'", "'\\''")}'`,
};

/**
 * The link that opens agent `id` with `prompt` already pasted. The prompt is used exactly as given.
 * @param {string} id an id from `agents`, case-sensitive
 * @param {string} prompt
 * @returns {Link}
 * @throws {Error & { code: "UNKNOWN_AGENT" | "EMPTY_PROMPT" | "TOO_LONG" }}
 */
export function linkFor(id, prompt) {
  const agent = agents.find((a) => a.id === id);
  if (!agent) {
    const near = agents.find((a) => a.id === String(id).toLowerCase());
    throw failure(
      "UNKNOWN_AGENT",
      `unknown agent ${JSON.stringify(String(id))}${near ? ` (ids are lower case: did you mean "${near.id}"?)` : ""}; ` +
        `use one of ${agents.map((a) => a.id).join(", ")}`,
      { agent: id },
    );
  }
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw failure("EMPTY_PROMPT", "the prompt is empty or only whitespace; give the agent something to do", {
      agent: agent.id,
    });
  }
  const value = agent.prefix + carry[agent.kind](prompt);
  if (agent.kind !== "command" && value.length > MAX_LINK_LENGTH) {
    const over = value.length - MAX_LINK_LENGTH;
    throw failure(
      "TOO_LONG",
      `the ${agent.name} link would be ${value.length} characters, ${over} over the ${MAX_LINK_LENGTH} limit ` +
        `(measured once URL-encoded); shorten the prompt, or use a command agent (claude-code, codex), which has no limit`,
      { agent: agent.id, length: value.length, max: MAX_LINK_LENGTH },
    );
  }
  return { agent: agent.id, kind: agent.kind, value };
}

/** An Error with a `code` and the details a caller may want to show. */
function failure(code, message, details) {
  return Object.assign(new Error(message), { code }, details);
}
