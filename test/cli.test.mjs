import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const cli = new URL("../bin/connect-agent.mjs", import.meta.url);

function run(args) {
  return spawnSync(process.execPath, [cli.pathname, ...args], { encoding: "utf8" });
}

test("list supports text and exact JSON projections", () => {
  const text = run(["list"]);
  assert.equal(text.status, 0);
  assert.equal(text.stderr, "");
  assert.equal(text.stdout.split("\n")[0], "claude\tClaude\turl");
  assert.equal(text.stdout.trimEnd().split("\n").length, 7);

  const json = run(["list", "--json"]);
  assert.equal(json.status, 0);
  assert.deepEqual(Object.keys(JSON.parse(json.stdout)[0]), ["id", "name", "kind"]);
});

test("link prints exactly one JSON object", () => {
  const result = run(["link", "claude", "Café & tea"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    agent: "claude",
    kind: "url",
    value: "https://claude.ai/new?q=Caf%C3%A9%20%26%20tea",
  });
  assert.deepEqual(Object.keys(JSON.parse(result.stdout)), ["agent", "kind", "value"]);
});

test("--file preserves UTF-8 content and its final newline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "connect-agent-test-"));
  try {
    const path = join(directory, "prompt.txt");
    const prompt = "déjà vu 🙂\n";
    await writeFile(path, prompt);
    const result = run(["link", "perplexity", "--file", path]);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).value, `https://www.perplexity.ai/search?q=${encodeURIComponent(prompt)}`);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("usage failures use exit 2, stderr only, and an actionable line", () => {
  const cases = [
    [],
    ["open"],
    ["list", "extra"],
    ["link"],
    ["link", "claude"],
    ["link", "claude", "   "],
    ["link", "Claude", "hello"],
    ["link", "claude", "--file"],
    ["link", "claude", "hello", "extra"],
    ["link", "claude", "hello", "--file", "prompt.txt"],
    ["link", "claude", "--file", "/definitely/missing/prompt.txt"],
  ];

  for (const args of cases) {
    const result = run(args);
    assert.equal(result.status, 2, args.join(" "));
    assert.equal(result.stdout, "", args.join(" "));
    assert.match(result.stderr, /^error: [^\n]+\n$/, args.join(" "));
  }
});

test("too-long links use exit 3 while commands have no link limit", () => {
  const tooLong = run(["link", "cursor", "x".repeat(9000)]);
  assert.equal(tooLong.status, 3);
  assert.equal(tooLong.stdout, "");
  assert.match(tooLong.stderr, /^error: .+Shorten the prompt/);

  const command = run(["link", "codex", "x".repeat(9000)]);
  assert.equal(command.status, 0);
});
