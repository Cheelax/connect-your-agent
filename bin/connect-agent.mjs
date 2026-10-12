#!/usr/bin/env node
// The CLI over src/harnesses.mjs: see ARCHITECTURE.md.
import { readFile } from "node:fs/promises";
import { agents, linkFor } from "../src/harnesses.mjs";

const args = process.argv.slice(2);

function fail(message, code = 2) {
  process.stderr.write(`error: ${message}\n`);
  process.exitCode = code;
}

function usage(message) {
  fail(`${message} Try \"list [--json]\" or \"link <agent> <prompt|--file path>\".`);
}

async function main() {
  const [command, ...rest] = args;

  if (command === "list") {
    if (rest.length === 0) {
      process.stdout.write(`${agents.map(({ id, name, kind }) => `${id}\t${name}\t${kind}`).join("\n")}\n`);
      return;
    }
    if (rest.length === 1 && rest[0] === "--json") {
      process.stdout.write(`${JSON.stringify(agents.map(({ id, name, kind }) => ({ id, name, kind })))}\n`);
      return;
    }
    usage("The list command accepts only the optional --json flag.");
    return;
  }

  if (command !== "link") {
    usage(command === undefined ? "A command is required." : `Unknown command ${JSON.stringify(command)}.`);
    return;
  }

  const [id, ...linkArgs] = rest;
  if (id === undefined) {
    usage("The link command requires an agent id and a prompt.");
    return;
  }

  let prompt;
  if (linkArgs[0] === "--file") {
    if (linkArgs.length !== 2) {
      usage(linkArgs.length < 2 ? "--file requires a path." : "--file accepts one path and no prompt or extra arguments.");
      return;
    }
    try {
      prompt = await readFile(linkArgs[1], "utf8");
    } catch {
      fail(`Could not read prompt file ${JSON.stringify(linkArgs[1])}; check that the path exists and is readable.`);
      return;
    }
  } else {
    if (linkArgs.length === 0) {
      usage("The link command requires a prompt or --file path.");
      return;
    }
    if (linkArgs.length !== 1) {
      usage(linkArgs.includes("--file") ? "Pass either one prompt or --file path, not both." : "The link command accepts exactly one prompt argument.");
      return;
    }
    prompt = linkArgs[0];
  }

  try {
    process.stdout.write(`${JSON.stringify(linkFor(id, prompt))}\n`);
  } catch (error) {
    if (error?.code === "TOO_LONG") {
      fail(`${error.message} Shorten the prompt or use a command agent.`, 3);
      return;
    }
    if (error?.code === "UNKNOWN_AGENT") {
      fail(`${error.message} Run \"list\" to see valid agent ids.`);
      return;
    }
    if (error?.code === "EMPTY_PROMPT") {
      fail(`${error.message} Supply text directly or with --file.`);
      return;
    }
    fail(`Could not build the link: ${error instanceof Error ? error.message : String(error)}.`);
  }
}

await main();
