import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/connect-agent.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "connect-agent-"));
const file = (name, content) => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};

const run = (...args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
};

/** Bad input: the exit code, nothing on stdout, one `error: ` line on stderr. */
function refused(args, code, pattern) {
  const r = run(...args);
  assert.equal(r.code, code, `${JSON.stringify(args)}: ${r.err}`);
  assert.equal(r.out, "");
  assert.match(r.err, /^error: [^\n]+\n$/);
  if (pattern) assert.match(r.err, pattern);
}

test("list prints one tab-separated line per agent", () => {
  const r = run("list");
  assert.equal(r.code, 0);
  assert.equal(r.out.split("\n")[0], "claude\tClaude\turl");
  assert.equal(r.out.split("\n").at(-2), "codex\tCodex CLI\tcommand");
  assert.equal(r.out.trim().split("\n").length, 7);
});

test("list --json prints the catalogue, without internal fields", () => {
  const r = run("list", "--json");
  assert.equal(r.code, 0);
  const rows = JSON.parse(r.out);
  assert.equal(rows.length, 7);
  assert.deepEqual(rows[4], { id: "cursor", name: "Cursor", kind: "deeplink" });
});

test("link prints one line of JSON with exactly agent, kind, value", () => {
  const r = run("link", "claude", "Explain this repo");
  assert.equal(r.code, 0);
  assert.equal(r.out, '{"agent":"claude","kind":"url","value":"https://claude.ai/new?q=Explain%20this%20repo"}\n');
});

test("link --file reads the prompt unchanged, final newline included", () => {
  const prompt = "Summarise this.\nIt's « déjà vu » 🙂\n";
  const r = run("link", "codex", "--file", file("prompt.txt", prompt));
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).value, `codex '${prompt.replaceAll("'", "'\\''")}'`);
});

test("a prompt that looks like an option is still a prompt", () => {
  assert.equal(JSON.parse(run("link", "chatgpt", "--json").out).value, "https://chatgpt.com/?q=--json");
});

test("usage errors exit 2 and say how to fix them", () => {
  refused([], 2, /no command/);
  refused(["open", "claude", "hi"], 2, /unknown command "open"/);
  refused(["list", "extra"], 2, /unexpected argument "extra"/);
  refused(["link"], 2, /needs an agent and a prompt/);
  refused(["link", "claude"], 2, /no prompt/);
  refused(["link", "gemini", "hi"], 2, /unknown agent "gemini".*claude, chatgpt/);
  refused(["link", "Claude", "hi"], 2, /did you mean "claude"/);
  refused(["link", "claude", ""], 2, /empty or only whitespace/);
  refused(["link", "claude", " \n\t "], 2, /empty or only whitespace/);
  refused(["link", "claude", "--file"], 2, /--file needs a path/);
  refused(["link", "claude", "hi", "--file", file("a.txt", "a")], 2, /not both/);
  refused(["link", "claude", "--file", file("b.txt", "b"), "extra"], 2, /unexpected argument "extra"/);
  refused(["link", "claude", "--file", join(dir, "missing.txt")], 2, /cannot read .*no such file/);
  refused(["link", "claude", "--file", dir], 2, /cannot read .*directory/);
  refused(["link", "claude", "--file", file("blank.txt", "  \n")], 2, /the prompt in ".*blank\.txt" is empty/);
  refused(["link", "codex", "hi", "extra"], 2, /quote the prompt/);
});

test("a link over 8,000 characters exits 3; a command never does", () => {
  refused(["link", "cursor", "x".repeat(9000)], 3, /9047 characters, 1047 over the 8000 limit/);
  refused(["link", "claude", "é".repeat(1400)], 3, /claude-code, codex/);
  assert.equal(run("link", "claude-code", "x".repeat(20_000)).code, 0);
});

test("help prints the usage", () => {
  const r = run("help");
  assert.equal(r.code, 0);
  assert.match(r.out, /^usage: connect-agent list/);
});
