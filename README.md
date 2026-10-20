# Connect your agent

A drop-in button for any web page. Like MetaMask's "Connect wallet", your visitor picks their agent
(Claude, ChatGPT, Perplexity, Le Chat, Cursor, Claude Code, Codex CLI) and it opens with your page's
prompt already pasted. No sign-in, no API key, nothing stored on a server: one click hands the task to
the visitor's own AI.

> **Status: round 2, the button.** The catalogue, link builder, CLI and web component work. Coding agents
> build the rest in rounds on [Hotpod](https://agent-launchpad-six.vercel.app):
> round 3 the connected state, round 4 smart prompts. [ARCHITECTURE.md](ARCHITECTURE.md) has the plan.

## Install and run

Node.js 20 or later, no dependency, nothing to install:

```sh
git clone https://github.com/Cheelax/connect-your-agent
cd connect-your-agent
node bin/connect-agent.mjs list                                # every agent
node bin/connect-agent.mjs link claude "Explain this repo"     # {"agent":"claude","kind":"url","value":"https://claude.ai/new?q=Explain%20this%20repo"}
npm test                                                       # the project's own tests
```

## The web component

Load the dependency-free module and add the element anywhere in a page:

```html
<script type="module" src="/src/connect-agent.mjs"></script>
<connect-agent prompt="Explain this page to me"></connect-agent>
```

The `prompt` attribute is passed through unchanged; an empty prompt disables the button. Set `label` to
replace “Connect your agent”. Both attributes are observed, so changing them updates an existing element.
The picker works with pointer, keyboard and screen reader navigation. URL agents open in a new tab,
desktop agents use their deep link, and command-line agents copy a safely quoted command to the clipboard.

Run `npm run demo` and open <http://127.0.0.1:8080/> to try it.

## The agents

| id | name | kind | what `value` is |
| --- | --- | --- | --- |
| `claude` | Claude | `url` | `https://claude.ai/new?q=` + the encoded prompt |
| `chatgpt` | ChatGPT | `url` | `https://chatgpt.com/?q=` + the encoded prompt |
| `perplexity` | Perplexity | `url` | `https://www.perplexity.ai/search?q=` + the encoded prompt |
| `le-chat` | Le Chat | `url` | `https://chat.mistral.ai/chat?q=` + the encoded prompt |
| `cursor` | Cursor | `deeplink` | `cursor://anysphere.cursor-deeplink/prompt?text=` + the encoded prompt |
| `claude-code` | Claude Code | `command` | `claude ` + the quoted prompt |
| `codex` | Codex CLI | `command` | `codex ` + the quoted prompt |

- A `url` opens in a browser, a `deeplink` opens the desktop app, a `command` is pasted in a terminal.
- **Encoded** is `encodeURIComponent(prompt)`: every character survives, `&`, `#`, `+`, newlines and
  emoji included.
- **Quoted** is one argument for a POSIX shell (bash, zsh, sh): the prompt between single quotes, each
  `'` written `'\''`. Nothing else is special inside single quotes, so `$HOME`, backticks, `\` and
  newlines reach the agent as typed, never expanded.
- A `url` or `deeplink` is at most **8,000 characters**, counted on the final link (an `é` is 6 once
  encoded). A `command` has no limit.

## The CLI

```sh
node bin/connect-agent.mjs list                       # id<TAB>name<TAB>kind, one agent per line
node bin/connect-agent.mjs list --json                # [{"id":"claude","name":"Claude","kind":"url"},…]
node bin/connect-agent.mjs link <agent> "<prompt>"    # one line of JSON: {"agent","kind","value"}
node bin/connect-agent.mjs link <agent> --file prompt.txt
node bin/connect-agent.mjs help
```

- The prompt is used **exactly as given**: never trimmed, never rewritten. With `--file`, it is the
  file's content read as UTF-8, its final newline included. Quote the prompt so the shell passes it as
  one argument; anything after `<agent>` is the prompt, even `--json`, except `--file` in first place.
- Try a command link without running the agent: replace `claude` with `printf %s`.

  ```sh
  eval "$(node bin/connect-agent.mjs link claude-code "it's \$HOME" | node -p 'JSON.parse(require("fs").readFileSync(0)).value.replace(/^claude /, "printf %s ")')"
  # it's $HOME
  ```

| Exit | When | stdout | stderr |
| --- | --- | --- | --- |
| 0 | success | the output | nothing |
| 2 | a usage error: no command or an unknown one, an unknown agent (ids are case-sensitive), no prompt, an empty or whitespace-only prompt (argument or file), `--file` with no path, both a prompt and `--file`, a file that cannot be read, an extra argument | nothing | one line, `error: <what was wrong and how to fix it>` |
| 3 | the `url` or `deeplink` would be longer than 8,000 characters | nothing | one line, `error: …` with the length and how to fix it |

```text
$ node bin/connect-agent.mjs link Claude "hi"
error: unknown agent "Claude" (ids are lower case: did you mean "claude"?); use one of claude, chatgpt, perplexity, le-chat, cursor, claude-code, codex (connect-agent list shows them)
$ node bin/connect-agent.mjs link cursor --file long.txt
error: the Cursor link would be 9047 characters, 1047 over the 8000 limit (measured once URL-encoded); shorten the prompt, or use a command agent (claude-code, codex), which has no limit
```

## The library

`src/harnesses.mjs` is a plain ES module with no import, so a web page can load it too:

```js
import { agents, linkFor, MAX_LINK_LENGTH } from "./src/harnesses.mjs";

agents;                                 // [{ id: "claude", name: "Claude", kind: "url", prefix: "…" }, …], frozen
linkFor("chatgpt", "Explain this repo"); // { agent: "chatgpt", kind: "url", value: "https://chatgpt.com/?q=Explain%20this%20repo" }

try {
  linkFor("cursor", hugePrompt);
} catch (error) {
  error.code;                           // "UNKNOWN_AGENT" | "EMPTY_PROMPT" | "TOO_LONG"
  error.length, error.max;              // on TOO_LONG: the link's length and 8000
}
```

## Add an agent

One entry in the `agents` array of [src/harnesses.mjs](src/harnesses.mjs), where it should appear in the
list (the order is the order of `list` and of the picker):

```js
{ id: "gemini", name: "Gemini", kind: "url", prefix: "https://gemini.example/app?q=" },
```

- `id`: lower case, used on the command line and, from round 2, in the button's `data-testid`.
- `kind` decides how the prompt is carried: `url` and `deeplink` append it URL-encoded and are held to
  8,000 characters; `command` appends it single-quoted, with no limit. A new kind is one more line in
  `carry`, next to the catalogue.
- `prefix`: the part of the value before the prompt. The service must accept the prompt as the last
  query parameter (or, for a command, as the last argument).

Then add it to the table above and to the catalogue test in
[test/harnesses.test.mjs](test/harnesses.test.mjs) (it pins every id, name and prefix), and run
`npm test`: the encoding, quoting and length tests run over every agent, the new one included.

## Build it with your agent

Anyone can enter this project's rounds with their coding agent: give it this prompt.

```text
I want you to contribute to Cheelax/connect-your-agent on Hotpod. Download https://agent-launchpad-six.vercel.app/skill/SKILL.md with curl, read all of it, and follow it: install the launchpad CLI and the skill, use the key in ~/.launchpad/<agent>/env (if I have no Hotpod agent yet, ask me to create one on https://agent-launchpad-six.vercel.app/me/agents and to save its key with the commands it shows; never ask me for the key itself), find this repository's project with launchpad projects, and enter its open round following roles/build.md.
```
