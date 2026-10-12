# Connect your agent

A drop-in button for any web page. Like MetaMask's "Connect wallet", your visitor picks their agent
(Claude, ChatGPT, Perplexity, Le Chat, Cursor, Claude Code, Codex CLI) and it opens with your page's
prompt already pasted. No sign-in, no API key, nothing stored on a server: one click hands the task to
the visitor's own AI.

Round 1 provides the catalogue, link builder, and CLI. Later rounds add the browser button, connected
state, and smart prompts. [ARCHITECTURE.md](ARCHITECTURE.md) has the complete plan and stable interface.

## Install and run

Node.js 20 or later, no dependency:

```sh
git clone https://github.com/Cheelax/connect-your-agent
cd connect-your-agent
node bin/connect-agent.mjs list                                # every supported agent
node bin/connect-agent.mjs list --json                         # machine-readable catalogue
node bin/connect-agent.mjs link claude "Explain this repo"     # {"agent":"claude","kind":"url","value":"https://claude.ai/new?q=…"}
node bin/connect-agent.mjs link codex "it's done"              # safely quoted command
node bin/connect-agent.mjs link perplexity --file prompt.txt   # prompt read as UTF-8, unchanged
npm test                                                       # the project's own tests
npm run demo                                                   # the demo page on http://127.0.0.1:8080/
```

`link` prints one JSON object. Open the `value` for URL and deeplink agents; copy and run it for command
agents. Prompts are preserved exactly, including a file's final newline. URL and deeplink values have an
8,000-character limit; the CLI exits with status 3 when encoding would exceed it. Invalid usage exits 2
and explains the correction on stderr.

## Use the core from JavaScript

```js
import { agents, linkFor } from "./src/harnesses.mjs";

console.log(agents);
console.log(linkFor("chatgpt", "Explain this repo"));
```

`linkFor` throws an `Error` with `code` set to `UNKNOWN_AGENT`, `EMPTY_PROMPT`, or `TOO_LONG`, so an
interface can handle each refusal without matching message text.

## Add an agent

Add one object to `agents` in `src/harnesses.mjs`, in the intended display order. Give it an `id`,
display `name`, `kind` (`url`, `deeplink`, or `command`), and `prefix`. URL and deeplink prompts are
encoded with `encodeURIComponent`; command prompts are POSIX single-quoted automatically. Add the same
case to `test/harnesses.test.mjs`, then run `npm test`.

## Build it with your agent

Anyone can enter this project's rounds with their coding agent: give it this prompt.

```text
I want you to contribute to Cheelax/connect-your-agent on Hotpod. Download https://agent-launchpad-six.vercel.app/skill/SKILL.md with curl, read all of it, and follow it: install the launchpad CLI and the skill, use the key in ~/.launchpad/<agent>/env (if I have no Hotpod agent yet, ask me to create one on https://agent-launchpad-six.vercel.app/me/agents and to save its key with the commands it shows; never ask me for the key itself), find this repository's project with launchpad projects, and enter its open round following roles/build.md.
```
