import assert from "node:assert/strict";
import test from "node:test";

import { agents, linkFor, MAX_LINK_LENGTH } from "../src/harnesses.mjs";

const expected = [
  ["claude", "Claude", "url", "https://claude.ai/new?q="],
  ["chatgpt", "ChatGPT", "url", "https://chatgpt.com/?q="],
  ["perplexity", "Perplexity", "url", "https://www.perplexity.ai/search?q="],
  ["le-chat", "Le Chat", "url", "https://chat.mistral.ai/chat?q="],
  ["cursor", "Cursor", "deeplink", "cursor://anysphere.cursor-deeplink/prompt?text="],
  ["claude-code", "Claude Code", "command", "claude "],
  ["codex", "Codex CLI", "command", "codex "],
];

test("catalogue has the required agents in display order", () => {
  assert.deepEqual(
    agents.map(({ id, name, kind, prefix }) => [id, name, kind, prefix]),
    expected,
  );
  assert.equal(MAX_LINK_LENGTH, 8000);
});

test("URL and deeplink agents encode the exact prompt", () => {
  const prompt = ` Café 🚀\n& # ' " $ \\ `;
  for (const [id, , kind, prefix] of expected.filter(([, , valueKind]) => valueKind !== "command")) {
    assert.deepEqual(linkFor(id, prompt), { agent: id, kind, value: prefix + encodeURIComponent(prompt) });
  }
});

test("command agents POSIX-quote without changing other characters", () => {
  const prompt = "it's $HOME `pwd` \\\"ok\\\"\nnext";
  assert.deepEqual(linkFor("claude-code", prompt), {
    agent: "claude-code",
    kind: "command",
    value: "claude 'it'\\''s $HOME `pwd` \\\"ok\\\"\nnext'",
  });
  assert.equal(linkFor("codex", "''").value, "codex ''\\'''\\'''" );
});

test("leading and trailing whitespace is preserved when prompt has content", () => {
  const prompt = "  \n hello \t\n";
  assert.equal(linkFor("chatgpt", prompt).value, `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`);
});

test("errors have stable codes", () => {
  assert.throws(() => linkFor("Claude", "hello"), { code: "UNKNOWN_AGENT" });
  assert.throws(() => linkFor("claude", " \n\t "), { code: "EMPTY_PROMPT" });
  assert.throws(() => linkFor("cursor", "é".repeat(1400)), { code: "TOO_LONG" });
});

test("link length boundary is inclusive and commands are unlimited", () => {
  const prefix = expected[0][3];
  assert.equal(linkFor("claude", "a".repeat(MAX_LINK_LENGTH - prefix.length)).value.length, MAX_LINK_LENGTH);
  assert.throws(() => linkFor("claude", "a".repeat(MAX_LINK_LENGTH - prefix.length + 1)), { code: "TOO_LONG" });
  assert.equal(linkFor("codex", "x".repeat(20_000)).value.length, 20_008);
});
