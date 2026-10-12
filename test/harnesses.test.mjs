import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { agents, linkFor, MAX_LINK_LENGTH } from "../src/harnesses.mjs";

const TRICKY = [
  "Explain this repo",
  "Café 🚀 naïve « déjà vu »",
  "line one\nline two\r\n",
  `"double" 'single' \`back\` $HOME $(whoami) \\n`,
  "a+b=c & d#e /path?x=1 100% ~*()!",
  "  leading and trailing  \t\n",
  "'",
  "''",
  "it's",
];

test("the catalogue is the seven agents, in the order of ARCHITECTURE.md", () => {
  assert.deepEqual(
    agents.map(({ id, name, kind }) => `${id}|${name}|${kind}`),
    [
      "claude|Claude|url",
      "chatgpt|ChatGPT|url",
      "perplexity|Perplexity|url",
      "le-chat|Le Chat|url",
      "cursor|Cursor|deeplink",
      "claude-code|Claude Code|command",
      "codex|Codex CLI|command",
    ],
  );
  assert.equal(MAX_LINK_LENGTH, 8000);
  assert.throws(() => agents.push({}), TypeError, "the catalogue is frozen");
});

test("each agent's value starts with its own prefix", () => {
  const prefixes = {
    claude: "https://claude.ai/new?q=",
    chatgpt: "https://chatgpt.com/?q=",
    perplexity: "https://www.perplexity.ai/search?q=",
    "le-chat": "https://chat.mistral.ai/chat?q=",
    cursor: "cursor://anysphere.cursor-deeplink/prompt?text=",
    "claude-code": "claude ",
    codex: "codex ",
  };
  for (const { id, kind } of agents) {
    assert.deepEqual(linkFor(id, "hi"), { agent: id, kind, value: prefixes[id] + (kind === "command" ? "'hi'" : "hi") });
  }
});

test("links carry the prompt exactly: decoding gives it back", () => {
  for (const { id, kind, prefix } of agents.filter((a) => a.kind !== "command")) {
    for (const prompt of TRICKY) {
      const { value } = linkFor(id, prompt);
      assert.equal(value, prefix + encodeURIComponent(prompt));
      const url = new URL(value);
      assert.equal(url.searchParams.get(id === "cursor" ? "text" : "q"), prompt, `${id}, ${kind}`);
    }
  }
});

test("commands carry the prompt exactly: a POSIX shell gets it back as one argument", () => {
  for (const id of ["claude-code", "codex"]) {
    for (const prompt of TRICKY) {
      const { value } = linkFor(id, prompt);
      const word = value.slice(value.indexOf(" ") + 1);
      const sh = spawnSync("sh", ["-c", `printf %s ${word}`], { encoding: "utf8" });
      assert.equal(sh.stdout, prompt, `${id} ${JSON.stringify(prompt)}`);
    }
  }
  assert.equal(linkFor("claude-code", "it's").value, "claude 'it'\\''s'");
});

test("an unknown agent is refused, with a hint for the wrong case", () => {
  assert.throws(() => linkFor("gemini", "hi"), { code: "UNKNOWN_AGENT" });
  assert.throws(() => linkFor("Claude", "hi"), (e) => e.code === "UNKNOWN_AGENT" && /did you mean "claude"/.test(e.message));
  assert.throws(() => linkFor("toString", "hi"), { code: "UNKNOWN_AGENT" });
});

test("an empty or whitespace-only prompt is refused", () => {
  for (const prompt of ["", " ", "\n\t ", " ", undefined, null, 42]) {
    assert.throws(() => linkFor("claude", prompt), { code: "EMPTY_PROMPT" }, JSON.stringify(prompt));
  }
  assert.equal(linkFor("claude", " x ").value, "https://claude.ai/new?q=%20x%20");
});

test("the limit is 8,000 characters on the final value, for urls and deeplinks only", () => {
  for (const { id, kind, prefix } of agents) {
    const fits = "a".repeat(MAX_LINK_LENGTH - prefix.length);
    if (kind === "command") {
      assert.equal(linkFor(id, "x".repeat(50_000)).value.length, prefix.length + 50_002);
      continue;
    }
    assert.equal(linkFor(id, fits).value.length, MAX_LINK_LENGTH);
    assert.throws(() => linkFor(id, `${fits}a`), (e) => e.code === "TOO_LONG" && e.length === 8001 && e.max === 8000);
  }
  // Measured once encoded: é is 6 characters in a link.
  assert.doesNotThrow(() => linkFor("chatgpt", "é".repeat(1300)));
  assert.throws(() => linkFor("chatgpt", "é".repeat(1400)), { code: "TOO_LONG" });
});
