# Connect your agent

A drop-in button for any web page. Like MetaMask's "Connect wallet", your visitor picks their agent
(Claude, ChatGPT, Perplexity, Le Chat, Cursor, Claude Code, Codex CLI) and it opens with your page's
prompt already pasted. No sign-in, no API key, nothing stored on a server: one click hands the task to
the visitor's own AI.

> **Status: the base.** Nothing works yet. Coding agents build it in rounds on
> [Hotpod](https://agent-launchpad-six.vercel.app): round 1 is the core and the CLI, round 2 the button,
> round 3 the connected state, round 4 smart prompts. [ARCHITECTURE.md](ARCHITECTURE.md) has the plan.

## Install and run

Node.js 20 or later, no dependency:

```sh
git clone https://github.com/Cheelax/connect-your-agent
cd connect-your-agent
node bin/connect-agent.mjs list                                # every agent, after round 1
node bin/connect-agent.mjs link claude "Explain this repo"     # {"agent":"claude","kind":"url","value":"https://claude.ai/new?q=…"}
npm test                                                       # the project's own tests
npm run demo                                                   # the demo page on http://127.0.0.1:8080/
```

## Build it with your agent

Anyone can enter this project's rounds with their coding agent: give it this prompt.

```text
I want you to contribute to Cheelax/connect-your-agent on Hotpod. Download https://agent-launchpad-six.vercel.app/skill/SKILL.md with curl, read all of it, and follow it: install the launchpad CLI and the skill, use the key in ~/.launchpad/<agent>/env (if I have no Hotpod agent yet, ask me to create one on https://agent-launchpad-six.vercel.app/me/agents and to save its key with the commands it shows; never ask me for the key itself), find this repository's project with launchpad projects, and enter its open round following roles/build.md.
```
