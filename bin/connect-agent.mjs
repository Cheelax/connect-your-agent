#!/usr/bin/env node
// The CLI over src/harnesses.mjs: see ARCHITECTURE.md and the README.
// Exit 0 on success, 2 on a usage error, 3 when a link would be too long. On an error, stdout stays
// empty and stderr gets one line starting with "error: ".
import { readFileSync } from "node:fs";
import { agents, linkFor } from "../src/harnesses.mjs";

const USAGE = `usage: connect-agent list [--json]
       connect-agent link <agent> <prompt>
       connect-agent link <agent> --file <path>`;

/** A refusal: its message goes to stderr, its exit code to the shell. */
class Refusal extends Error {
  constructor(message, exit = 2) {
    super(message);
    this.exit = exit;
  }
}

const show = (s) => JSON.stringify(s);

function list(args) {
  const json = args[0] === "--json";
  extra(args.slice(json ? 1 : 0), "list takes no argument but --json");
  const rows = agents.map(({ id, name, kind }) => ({ id, name, kind }));
  return json ? JSON.stringify(rows) : rows.map((a) => `${a.id}\t${a.name}\t${a.kind}`).join("\n");
}

function link(args) {
  const [id, ...rest] = args;
  if (id === undefined) throw new Refusal(`link needs an agent and a prompt: connect-agent link <agent> <prompt> (agents: ${ids()})`);
  let prompt;
  let source = "the prompt";
  if (rest[0] === "--file") {
    const path = rest[1];
    if (path === undefined) throw new Refusal("--file needs a path: connect-agent link <agent> --file <path>");
    extra(rest.slice(2), "give the prompt with --file <path> only");
    prompt = read(path);
    source = `the prompt in ${show(path)}`;
  } else {
    prompt = rest[0];
    if (prompt === undefined) {
      throw new Refusal(`no prompt for ${show(id)}: connect-agent link ${id} <prompt>, or --file <path> to read it from a file`);
    }
    if (rest.includes("--file")) {
      throw new Refusal("give either a prompt or --file <path>, not both");
    }
    extra(rest.slice(1), "quote the prompt so that it is one argument");
  }
  try {
    return JSON.stringify(linkFor(id, prompt));
  } catch (error) {
    if (error.code === "EMPTY_PROMPT") throw new Refusal(`${source} is empty or only whitespace: give the agent something to do`);
    if (error.code === "UNKNOWN_AGENT") throw new Refusal(`${error.message} (connect-agent list shows them)`);
    if (error.code === "TOO_LONG") throw new Refusal(error.message, 3);
    throw error;
  }
}

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const why =
      { ENOENT: "no such file", EISDIR: "it is a directory", EACCES: "permission denied" }[error.code] ?? error.message;
    throw new Refusal(`cannot read ${show(path)}: ${why}; check the path`);
  }
}

function extra(args, hint) {
  if (args.length > 0) throw new Refusal(`unexpected argument ${show(args[0])}: ${hint}`);
}

const ids = () => agents.map((a) => a.id).join(", ");

function main(argv) {
  const [command, ...args] = argv;
  switch (command) {
    case "list":
      return list(args);
    case "link":
      return link(args);
    case "help":
    case "--help":
    case "-h":
      extra(args, "help takes no argument");
      return USAGE;
    case undefined:
      throw new Refusal("no command: use connect-agent list, or connect-agent link <agent> <prompt> (connect-agent help shows how)");
    default:
      throw new Refusal(`unknown command ${show(command)}: use list or link (connect-agent help shows how)`);
  }
}

// A reader that stops early (`| head`) is not an error.
process.stdout.on("error", (error) => {
  if (error.code !== "EPIPE") throw error;
});

try {
  process.stdout.write(`${main(process.argv.slice(2))}\n`);
} catch (error) {
  // One line, whatever the message holds.
  process.stderr.write(`error: ${String(error instanceof Refusal ? error.message : error?.message ?? error).replaceAll("\n", " ")}\n`);
  process.exitCode = error instanceof Refusal ? error.exit : 1;
}
