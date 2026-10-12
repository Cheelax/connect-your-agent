// Round 1's checks: the agents catalogue and the CLI (see ARCHITECTURE.md, "The CLI").
// The entry runs only in child processes: `node bin/connect-agent.mjs …`.
import { check, harness } from "./lib/harness.mjs";
import { entry, input } from "./lib/entry.mjs";

const { test, done } = harness();
const cli = entry("node", ["bin/connect-agent.mjs"]);

const AGENTS = [
  { id: "claude", name: "Claude", kind: "url", base: "https://claude.ai/new?q=" },
  { id: "chatgpt", name: "ChatGPT", kind: "url", base: "https://chatgpt.com/?q=" },
  { id: "perplexity", name: "Perplexity", kind: "url", base: "https://www.perplexity.ai/search?q=" },
  { id: "le-chat", name: "Le Chat", kind: "url", base: "https://chat.mistral.ai/chat?q=" },
  { id: "cursor", name: "Cursor", kind: "deeplink", base: "cursor://anysphere.cursor-deeplink/prompt?text=" },
  { id: "claude-code", name: "Claude Code", kind: "command", base: "claude " },
  { id: "codex", name: "Codex CLI", kind: "command", base: "codex " },
];
const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const expected = (id, prompt) => {
  const a = byId[id];
  return { agent: id, kind: a.kind, value: a.base + (a.kind === "command" ? quote(prompt) : encodeURIComponent(prompt)) };
};
const show = (s) => JSON.stringify(s.length > 200 ? `${s.slice(0, 200)}…` : s);

/** Runs `link …` and returns the parsed line; throws unless it exits 0 with exactly one line of JSON. */
async function link(args, what) {
  const r = await cli(["link", ...args]);
  check(r.code === 0, `${what}: \`${r.cmd.slice(0, 120)}\` exited with ${r.code ?? r.signal}${r.err.trim() ? `: ${r.err.trim().slice(0, 300)}` : ""}`);
  check(/^[^\n]*\n?$/.test(r.out) && r.out.trim() !== "", `${what}: stdout must be one line of JSON, got ${show(r.out)}`);
  let v;
  try {
    v = JSON.parse(r.out);
  } catch {
    throw new Error(`${what}: stdout is not JSON: ${show(r.out)}`);
  }
  check(v && typeof v === "object" && !Array.isArray(v), `${what}: stdout must be a JSON object, got ${show(r.out)}`);
  return v;
}

/** Runs `link …` and checks it prints exactly the expected { agent, kind, value }. */
async function linkIs(id, prompt, args, what) {
  const v = await link(args, what);
  const want = expected(id, prompt);
  const keys = Object.keys(v).sort().join(",");
  check(keys === "agent,kind,value", `${what}: the object must have exactly the keys agent, kind, value; got ${keys}`);
  check(v.agent === want.agent, `${what}: agent is ${show(String(v.agent))}, expected ${show(want.agent)}`);
  check(v.kind === want.kind, `${what}: kind is ${show(String(v.kind))}, expected ${show(want.kind)}`);
  check(v.value === want.value, `${what}: value is\n  ${show(String(v.value))}\nexpected\n  ${show(want.value)}`);
}

/** Runs the CLI on bad input: it must exit `code`, print nothing on stdout and start stderr with "error: ". */
async function refuses(args, code, what) {
  const r = await cli(args);
  check(r.code === code, `${what}: \`${r.cmd.slice(0, 120)}\` exited with ${r.code ?? r.signal}, expected ${code}`);
  check(r.out === "", `${what}: printed something on stdout: ${show(r.out)}`);
  check(r.err.startsWith("error: ") && r.err.trim().length > "error:".length, `${what}: stderr must start with "error: " and say why, got ${show(r.err)}`);
}

const SIMPLE = 'Review https://example.com/a?b=1&c=2#top and say if it\'s "done"';

await test("list prints the seven agents, one line each as <id>\\t<name>\\t<kind>, in catalogue order", async () => {
  const r = await cli(["list"]);
  check(r.code === 0, `list exited with ${r.code ?? r.signal}${r.err.trim() ? `: ${r.err.trim().slice(0, 300)}` : ""}`);
  const want = AGENTS.map((a) => `${a.id}\t${a.name}\t${a.kind}`).join("\n");
  check(r.out.replace(/\n$/, "") === want, `list printed\n${r.out}\nexpected\n${want}`);
});

await test("list --json prints a JSON array of { id, name, kind } in catalogue order", async () => {
  const r = await cli(["list", "--json"]);
  check(r.code === 0, `list --json exited with ${r.code ?? r.signal}${r.err.trim() ? `: ${r.err.trim().slice(0, 300)}` : ""}`);
  let v;
  try {
    v = JSON.parse(r.out);
  } catch {
    throw new Error(`list --json: stdout is not JSON: ${show(r.out)}`);
  }
  check(Array.isArray(v), "list --json must print an array");
  const got = JSON.stringify(v.map((a) => ({ id: a?.id, name: a?.name, kind: a?.kind })));
  const want = JSON.stringify(AGENTS.map(({ id, name, kind }) => ({ id, name, kind })));
  check(got === want, `list --json gave ${got}\nexpected ${want}`);
});

for (const a of AGENTS) {
  const how = a.kind === "command" ? "the prompt single-quoted" : "the prompt URL-encoded";
  await test(`link ${a.id} prints one JSON line { agent, kind: "${a.kind}", value: "${a.base}…" } with ${how}`, async () => {
    await linkIs(a.id, SIMPLE, [a.id, SIMPLE], `link ${a.id}`);
  });
}

await test("link URL-encodes Unicode, emoji, newlines, quotes, spaces, +, & and # exactly as encodeURIComponent does", async () => {
  const prompt = "Café 🚀 naïve\n\"quoted\" 'single' a+b=c & d#e /path?x=1 100% ~*()!";
  for (const id of ["claude", "chatgpt", "le-chat", "cursor"]) await linkIs(id, prompt, [id, prompt], `link ${id} with a tricky prompt`);
});

await test("link single-quotes a command for a POSIX shell: each ' becomes '\\'' and $, `, \\, \" and newlines stay as they are", async () => {
  const prompts = ["it's", "Don't run `rm -rf /` or $(whoami); echo \"$HOME\" \\n\nsecond line", "''", "a'b'c"];
  for (const p of prompts) for (const id of ["claude-code", "codex"]) await linkIs(id, p, [id, p], `link ${id} ${show(p)}`);
});

await test("link uses the prompt exactly as given: leading and trailing spaces and newlines are kept", async () => {
  const prompt = "  \n  indented prompt \t\n\n";
  await linkIs("chatgpt", prompt, ["chatgpt", prompt], "link chatgpt with surrounding whitespace");
  await linkIs("codex", prompt, ["codex", prompt], "link codex with surrounding whitespace");
});

await test("link <id> --file <path> reads the prompt from a UTF-8 file, unchanged (its final newline included)", async () => {
  const prompt = "Summarise this page.\nIt's in French: « déjà vu » 🙂\n";
  const file = input(prompt, "prompt.txt");
  await linkIs("perplexity", prompt, ["perplexity", "--file", file], "link perplexity --file");
  await linkIs("claude-code", prompt, ["claude-code", "--file", file], "link claude-code --file");
});

await test("link accepts a url of exactly 8000 characters and refuses one of 8001 with exit 3", async () => {
  const base = byId.claude.base;
  const fits = "a".repeat(8000 - base.length);
  await linkIs("claude", fits, ["claude", fits], "a url of exactly 8000 characters");
  await refuses(["link", "claude", `${fits}a`], 3, "a url of 8001 characters");
});

await test("link measures the 8000-character limit on the encoded link, not on the raw prompt (exit 3)", async () => {
  const fits = "é".repeat(1300); // 7,800 characters once encoded
  await linkIs("chatgpt", fits, ["chatgpt", fits], "1300 × é (7,800 encoded characters)");
  await refuses(["link", "chatgpt", "é".repeat(1400)], 3, "1400 × é (8,400 encoded characters, 1,400 raw)");
});

await test("the 8000-character limit applies to the cursor deeplink (exit 3) but never to commands", async () => {
  const long = "x".repeat(20_000);
  await refuses(["link", "cursor", long], 3, "a cursor deeplink over 8000 characters");
  await linkIs("claude-code", long, ["claude-code", long], "a claude-code command of 20,000 characters");
  await linkIs("codex", long, ["codex", long], "a codex command of 20,000 characters");
});

await test("link refuses an unknown agent with exit 2 and an error: line on stderr", async () => {
  await linkIs("claude", "hi", ["claude", "hi"], "a known agent");
  await refuses(["link", "gemini", "hi"], 2, "an unknown agent");
  await refuses(["link", "Claude", "hi"], 2, "an agent id in the wrong case");
});

await test("link refuses an empty or whitespace-only prompt with exit 2", async () => {
  await linkIs("claude", " x ", ["claude", " x "], "a prompt with one visible character");
  await refuses(["link", "claude", ""], 2, "an empty prompt");
  await refuses(["link", "claude", " \n\t "], 2, "a whitespace-only prompt");
  await refuses(["link", "codex", "--file", input("  \n", "blank.txt")], 2, "a whitespace-only prompt file");
});

await test("link refuses a missing prompt, a missing agent, or both a prompt and --file, with exit 2", async () => {
  const file = input("Explain this repo", "explain.txt");
  await linkIs("claude", "Explain this repo", ["claude", "--file", file], "a prompt from --file alone");
  await refuses(["link", "claude"], 2, "no prompt");
  await refuses(["link"], 2, "no agent and no prompt");
  await refuses(["link", "claude", "--file"], 2, "--file with no path");
  await refuses(["link", "claude", "hi", "--file", file], 2, "both a prompt and --file");
});

await test("link refuses a --file that cannot be read with exit 2", async () => {
  const file = input("ok", "ok.txt");
  await linkIs("chatgpt", "ok", ["chatgpt", "--file", file], "a readable file");
  await refuses(["link", "chatgpt", "--file", `${file}.missing`], 2, "a file that does not exist");
});

await test("the CLI refuses no command, an unknown command and an extra argument with exit 2", async () => {
  const r = await cli(["list"]);
  check(r.code === 0, `list exited with ${r.code ?? r.signal}`);
  await linkIs("codex", "hi", ["codex", "hi"], "a valid link");
  await refuses([], 2, "no command");
  await refuses(["open", "claude", "hi"], 2, "an unknown command");
  await refuses(["list", "extra"], 2, "list with an extra argument");
  await refuses(["link", "codex", "hi", "extra"], 2, "link with an extra argument");
});

done();
