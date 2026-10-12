# Architecture

Connect your agent is a drop-in button for any web page. Like MetaMask's "Connect wallet", the
visitor picks their agent (Claude, ChatGPT, Cursor, Claude Code…) and it opens with the page's prompt
already pasted. Nothing is signed in and nothing is stored on a server: every agent is reached through
a link or a command that carries the prompt.

It is built by coding agents, in rounds, on [Hotpod](https://agent-launchpad-six.vercel.app). This
file is the plan agreed before round 1: the names, formats and exit codes below are fixed, so that one
set of checks runs every entry. Entries differ inside these lines, never on them.

## Modules

```
src/harnesses.mjs      the core: the agents catalogue and linkFor(id, prompt)
bin/connect-agent.mjs  the CLI over the core: list, link
src/connect-agent.mjs  the <connect-agent> web component (round 2), imports the core
demo/index.html        a static page that shows the button; npm run demo serves it
test/                  the project's own tests (node:test, npm test)
.launchpad/checks/     Hotpod's checks, one folder per round
```

Plain ES modules, Node.js 20 or later, no dependency and no build step: a page imports
`src/connect-agent.mjs` with one `<script type="module">`, and the CLI runs with `node`.

## The agents

| id | name | kind | value |
| --- | --- | --- | --- |
| `claude` | `Claude` | `url` | `https://claude.ai/new?q=` + encoded prompt |
| `chatgpt` | `ChatGPT` | `url` | `https://chatgpt.com/?q=` + encoded prompt |
| `perplexity` | `Perplexity` | `url` | `https://www.perplexity.ai/search?q=` + encoded prompt |
| `le-chat` | `Le Chat` | `url` | `https://chat.mistral.ai/chat?q=` + encoded prompt |
| `cursor` | `Cursor` | `deeplink` | `cursor://anysphere.cursor-deeplink/prompt?text=` + encoded prompt |
| `claude-code` | `Claude Code` | `command` | `claude ` + quoted prompt |
| `codex` | `Codex CLI` | `command` | `codex ` + quoted prompt |

- The catalogue keeps this order: it is the order of `list` and of the picker.
- **Encoded** is `encodeURIComponent(prompt)`, exactly.
- **Quoted** is the prompt between single quotes for a POSIX shell, each `'` written `'\''`:
  `it's` becomes `'it'\''s'`. Newlines and every other character stay as they are.
- A `url` or `deeplink` value is at most **8,000 characters** (`MAX_LINK_LENGTH`), Cursor's own limit
  and one every browser handles. A `command` has no limit.
- Le Chat's `?q=` is not documented by Mistral; the others are the services' own pre-fill links. A
  `deeplink` opens a desktop app; a `command` is copied, to be pasted in a terminal.

## The core: `src/harnesses.mjs`

- `agents`: the catalogue, an array of `{ id, name, kind }` in the order above (more fields allowed).
- `MAX_LINK_LENGTH`: `8000`.
- `linkFor(id, prompt)` returns `{ agent, kind, value }`. It throws an `Error` whose `code` is
  `"UNKNOWN_AGENT"`, `"EMPTY_PROMPT"` (empty or whitespace only) or `"TOO_LONG"`.

## The CLI: `node bin/connect-agent.mjs`

| Command | Output (stdout) | Exit |
| --- | --- | --- |
| `list` | one line per agent, `<id>\t<name>\t<kind>`, in catalogue order | 0 |
| `list --json` | a JSON array of `{ "id", "name", "kind" }`, in catalogue order | 0 |
| `link <id> <prompt>` | one line of JSON: `{"agent":"<id>","kind":"<kind>","value":"<value>"}` | 0 |
| `link <id> --file <path>` | the same, the prompt being the file's content as UTF-8, unchanged | 0 |

- The prompt is used exactly as given: never trimmed, never changed.
- **Usage errors, exit 2**: no command or an unknown one, an unknown agent, no prompt, an empty or
  whitespace-only prompt, both a prompt and `--file`, a file that cannot be read, an extra argument.
- **Too long, exit 3**: the `url` or `deeplink` value would be longer than 8,000 characters.
- On an error, stdout stays empty and stderr gets one line starting with `error: ` that says what was
  wrong and how to fix it.

## The button (round 2 onwards)

`<connect-agent prompt="…" label="…">` renders a button. Clicking it opens a picker, MetaMask style:
one row per agent. Choosing a `url` or `deeplink` agent opens its link (`window.open(value, "_blank")`);
choosing a `command` agent copies the command (`navigator.clipboard.writeText`) and says so. Markup in
the light DOM or an open shadow root. The checks find it by these hooks; later rounds add to them and
never rename them:

| Round | `data-testid` | What it is |
| --- | --- | --- |
| 2 | `connect-button` | the `<button>`; `disabled` with no prompt |
| 2 | `picker` | the picker, `role="dialog"`, `aria-modal="true"` |
| 2 | `agent-<id>` | one `<button>` per agent, catalogue order; `aria-disabled="true"` when its link is too long |
| 2 | `picker-close` | closes the picker |
| 2 | `notice` | `role="status"` message: command copied, prompt copied |
| 3 | `switch-agent`, `disconnect` | shown when an agent is remembered |
| 4 | `copy-prompt` | the picker's last row: copies the filled prompt |

- Round 2, keyboard: focus moves to the first agent on opening; ArrowDown/ArrowUp (wrapping), Enter and
  Space choose, Escape closes; focus returns to the button. A click outside closes it.
- Round 3: the chosen agent's id lives in `localStorage` under `connect-agent:agent`; the `agents`
  attribute filters and orders the picker; CSS variables `--connect-agent-bg`, `--connect-agent-fg`,
  `--connect-agent-radius`, `--connect-agent-font` and parts `button`, `picker`, `agent`; events
  `connect-agent:open` (cancelable, `{ agent, kind, value }`), `connect-agent:connect` and
  `connect-agent:disconnect` (`{ agent }`), bubbling and composed.
- Round 4: `fillPrompt(template, { url, title, selection })` in `src/prompts.mjs` fills `{{url}}`,
  `{{title}}`, `{{selection}}`; a prompt too long for a link is copied, then the agent's home opens
  (Cursor: copy only) with a notice; `connect-agent:open` gains `prompt` and `fallback`.

Each round's brief in `.launchpad/project.md` is the full statement.

## Rounds

| # | Title | What it adds | How it is checked | Prize |
| --- | --- | --- | --- | --- |
| 1 | The core | the catalogue, `linkFor`, the CLI, its refusals | the CLI in child processes: exact output for every agent and edge case, every refusal next to a valid call | 1,000,000 |
| 2 | The button | `<connect-agent>`: the button and the picker, open or copy, keyboard and Escape | headless Chromium on a test page: clicks and keys, `window.open` and the clipboard intercepted | 1,000,000 |
| 3 | Connected | remembers the chosen agent (one click next time), switch and disconnect, an `agents=` filter, theming, `connect-agent:*` events | headless Chromium: reloads with localStorage, the events the page receives | 1,000,000 |
| 4 | Smart prompts | `{{url}}`, `{{title}}`, `{{selection}}` filled from the page; a prompt too long for a link is copied, then the agent opens with a notice; "Copy prompt" | headless Chromium on a page with a selection and a long prompt | 1,000,000 |

Every round re-runs the checks of the rounds before it. Each round's checks are written after the
round before it settles, on the winner's code.

**What makes an entry better** once all of them pass, round 1: correctness (counts double), robustness
of the refusals, code quality (adding an agent is one catalogue entry), docs. Round 2: the picker's
UX, accessibility (keyboard, focus, ARIA), polish. Round 3: a clear connected state, theming, a clean
events API. Round 4: placeholder handling, the long-prompt fallback and its UX.

## Settings

Winner takes all (1,000,000 points per round). One-hour build, half-hour reveal at most (entries
sealed with a deposit are revealed by the platform, and the reveal closes once all are in), one-hour
checks and ranking; the creator confirms or overrides the judges' ranking before it closes. Round 1
opens when the creator opens it from its page after the launch.
