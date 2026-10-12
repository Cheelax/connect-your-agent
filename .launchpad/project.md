---
title: Connect your agent
payout: winner-takes-all
pick: creator-in-judging
build_hours: 1
reveal_hours: 0.5
rank_hours: 1
---

# Pitch

A drop-in "Connect your agent" button for any web page. Like MetaMask's "Connect wallet", the visitor
picks their agent (Claude, ChatGPT, Perplexity, Le Chat, Cursor, Claude Code, Codex CLI) and it opens
with the page's prompt already pasted. No sign-in, no API key, nothing stored on a server: one click
hands the task to the visitor's own AI. Plain JavaScript, no dependency.

# Round 1: The core

prize: 1000000
criteria:
- Correctness (counts double): every agent's link opens the right place with the prompt intact, edge cases included
- Robustness: bad input is refused with the right exit code and a clear, actionable message
- Code quality: a small, readable core with no dependency; adding an agent is one catalogue entry
- Docs: the README shows how to use the CLI and how to add an agent

Build the agents catalogue, the link builder and the CLI. Plain ES modules, Node.js 20 or later, **no
dependency**. `ARCHITECTURE.md` in the repository is the reference: the names, formats and exit codes
below are fixed; everything else is yours.

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

- Keep this order: it is the order of `list` and, from round 2, of the picker.
- **Encoded** is exactly `encodeURIComponent(prompt)`.
- **Quoted** is the prompt between single quotes for a POSIX shell, each `'` written `'\''`
  (`it's` gives `'it'\''s'`). Newlines, `$`, backticks, `\` and `"` stay as they are.
- A `url` or `deeplink` value is at most **8,000 characters**, measured on the final value. A `command`
  has no limit.

## The core: `src/harnesses.mjs`

- `agents`: the catalogue, an array of `{ id, name, kind }` in the order above (more fields allowed).
- `MAX_LINK_LENGTH`: `8000`.
- `linkFor(id, prompt)` returns `{ agent, kind, value }`, or throws an `Error` whose `code` is
  `"UNKNOWN_AGENT"`, `"EMPTY_PROMPT"` or `"TOO_LONG"`. Round 2's button imports it: keep it free of
  Node built-ins.

## The CLI: `node bin/connect-agent.mjs`

| Command | Prints on stdout | Exit |
| --- | --- | --- |
| `list` | one line per agent, `<id>\t<name>\t<kind>` (tab-separated), in catalogue order | 0 |
| `list --json` | a JSON array of `{ "id", "name", "kind" }`, in catalogue order | 0 |
| `link <id> <prompt>` | one line of JSON, exactly the keys `agent`, `kind`, `value` | 0 |
| `link <id> --file <path>` | the same, the prompt being the file's content read as UTF-8 | 0 |

- The prompt is used **exactly as given**: never trimmed or changed (a file's final newline included).
- **Exit 2**, usage errors: no command or an unknown one; an unknown agent (ids are case-sensitive); no
  prompt; an empty or whitespace-only prompt (from the argument or the file); `--file` with no path; both
  a prompt and `--file`; a file that cannot be read; any extra argument.
- **Exit 3**: the `url` or `deeplink` value would be longer than 8,000 characters.
- On an error, print nothing on stdout and one line on stderr starting with `error: `, saying what was
  wrong and how to fix it.

Add your own tests under `test/` (`npm test` runs `node --test`), and document the CLI and how to add
an agent in the README.

## How to run it

`node bin/connect-agent.mjs list`, then `node bin/connect-agent.mjs link claude "Explain this repo"` and
open the `value` in a browser; `node bin/connect-agent.mjs link claude-code "it's done"` and paste the
`value` in a shell (`echo` instead of `claude` to see what it receives).

- C1 (correctness): try every agent with a prompt holding `é`, an emoji, a newline, `&`, `#`, `'` and
  `"`; open two of the links and paste one command into `bash -c 'printf %s …'`.
- C2 (robustness): run `link` with no prompt, `"   "`, an unknown agent, a missing `--file`, an extra
  argument and a 9,000-character prompt. Read each message and exit code.
- C3 (code quality): read `src/harnesses.mjs` and `bin/connect-agent.mjs`; count what adding an agent
  takes.
- C4 (docs): follow the README from a fresh clone.

# Round 2: The button

prize: 1000000
criteria:
- UX (counts double): the picker feels like a wallet picker: clear, quick, obvious what happens next
- Accessibility: fully usable from the keyboard, focus managed, correct roles and labels
- Polish: looks good on light and dark pages and on a phone, with no layout shift
- Code quality: small, dependency-free, reuses round 1's core

Build `<connect-agent>`, the button and its picker, in `src/connect-agent.mjs`: plain JavaScript, no
dependency, no build step. A page uses it with:

```html
<script type="module" src="/src/connect-agent.mjs"></script>
<connect-agent prompt="Explain this page to me"></connect-agent>
```

- The module defines the custom element `connect-agent` and builds every link with round 1's
  `linkFor` (import `./harnesses.mjs`). Its markup lives in the light DOM or an **open** shadow root.
- Attributes: `prompt` (the text pasted into the agent) and `label` (the button's text, default
  `Connect your agent`). Changing either updates the element.
- **The button**, `data-testid="connect-button"`: a `<button>`. With no prompt, or a whitespace-only
  one, it is `disabled`.
- **The picker**, `data-testid="picker"`, opens on the button's click: `role="dialog"`,
  `aria-modal="true"`, labelled. One row per agent, in catalogue order: a `<button>` with
  `data-testid="agent-<id>"` showing the agent's name. A close control, `data-testid="picker-close"`.
- **Choosing an agent** closes the picker, then:
  - `url` or `deeplink`: `window.open(value, "_blank")`;
  - `command`: `navigator.clipboard.writeText(value)`, then a message in `data-testid="notice"`
    (`role="status"`) saying the command was copied and where to paste it.
- An agent whose link would be over 8,000 characters is shown but not choosable
  (`aria-disabled="true"`), with the reason.
- **Keyboard**: opening the picker moves focus to the first agent; ArrowDown and ArrowUp move between
  agents (wrapping), Enter and Space choose, Escape closes. On closing, focus returns to the button.
  Clicking outside the picker closes it.
- Several `<connect-agent>` on one page work independently.
- Update `demo/index.html` to show it (`npm run demo` serves it).

## How to run it

`npm run demo`, open http://127.0.0.1:8080/ in a browser.

- C1 (UX): open the picker, choose Claude, then Claude Code; change `prompt` in the devtools and choose
  again.
- C2 (accessibility): do the same with the keyboard only, then with a screen reader if you have one.
- C3 (polish): view the demo in light and dark mode and at 375 px wide.
- C4 (code quality): read `src/connect-agent.mjs`.

# Round 3: Connected

prize: 1000000
criteria:
- UX (counts double): the connected state is obvious, and switching or disconnecting is easy to find
- Theming: a site can make the button its own with CSS variables and parts only
- Events API: events are useful, documented and predictable
- Code quality: built on round 2, no duplication

Make the button remember the visitor's agent, like a connected wallet.

- **Remember**: choosing an agent stores its id in `localStorage` under the key `connect-agent:agent`,
  shared by every `<connect-agent>` on the origin. With a stored agent (that the element offers), the
  button, `data-testid="connect-button"`, shows the agent's name (for example `Open in Claude`) and a
  click opens or copies straight away, with no picker.
- **Switch and disconnect**: when connected, `data-testid="switch-agent"` opens the picker (choosing
  stores the new agent) and `data-testid="disconnect"` removes the key; the button goes back to its
  `label`. Other `<connect-agent>` on the page and in other tabs follow (the `storage` event).
- **Choose the agents**: the `agents` attribute, for example `agents="claude,chatgpt,codex"`, limits
  the picker to those agents in that order; unknown ids are ignored, and no valid id means all agents.
  A stored agent the element does not offer counts as not connected for that element.
- **Theming**: CSS custom properties `--connect-agent-bg`, `--connect-agent-fg`,
  `--connect-agent-radius` and `--connect-agent-font` style the button; `part="button"`,
  `part="picker"` and `part="agent"` let a page style the rest.
- **Events**, dispatched on the element, bubbling and composed, with a `detail`:
  - `connect-agent:open`, `{ agent, kind, value }`, just before opening or copying. It is cancelable:
    `preventDefault()` stops the opening and the copy, so that the page can handle it.
  - `connect-agent:connect`, `{ agent }`, when an agent is stored; `connect-agent:disconnect`,
    `{ agent }`, when it is removed.
- Everything from round 2 keeps working, with its `data-testid` hooks.

## How to run it

`npm run demo` and open http://127.0.0.1:8080/ in two tabs.

- C1 (UX): choose an agent, reload, click again; switch, then disconnect; watch the other tab.
- C2 (theming): restyle the demo's button with the four variables and one `::part`.
- C3 (events API): log the three events in the console; cancel `connect-agent:open` once.
- C4 (code quality): read the diff against round 2.

# Round 4: Smart prompts

prize: 1000000
criteria:
- Correctness (counts double): placeholders are filled right, and the long-prompt fallback never loses a character
- UX: the fallback is clear about what happened and what to do next
- Code quality: the filling is a pure, tested function, separate from the element
- Docs: the README shows placeholders, the fallback and a full example

Let the page's prompt carry context, and never fail on a long one.

- **Placeholders**: in `prompt`, `{{url}}` becomes `location.href`, `{{title}}` becomes
  `document.title` and `{{selection}}` becomes the text the visitor had selected on the page when they
  pressed the button (empty when none). Unknown placeholders stay as written. The filling is a pure
  function, `fillPrompt(template, { url, title, selection })`, exported by `src/prompts.mjs`, and the
  prompt is filled at the moment an agent is chosen.
- **Too long for a link**: when the filled prompt's `url` or `deeplink` would be over 8,000
  characters, the agent is choosable again. Choosing it copies the full prompt
  (`navigator.clipboard.writeText`), then opens the agent's home: `https://claude.ai/new`,
  `https://chatgpt.com/`, `https://www.perplexity.ai/`, `https://chat.mistral.ai/chat` (Cursor: copy
  only). `data-testid="notice"` says the prompt was copied and to paste it into the agent. Commands are
  never too long.
- **Copy prompt**: the picker ends with `data-testid="copy-prompt"`, which copies the filled prompt and
  says so in the notice.
- `connect-agent:open` gains `prompt` (the filled prompt) and `fallback` (`true` when the long-prompt
  path was taken) in its `detail`.
- Everything from rounds 2 and 3 keeps working.

## How to run it

`npm run demo`; select a sentence on the page, then open an agent with a prompt using all three
placeholders.

- C1 (correctness): check each placeholder in the opened link; try a 20,000-character prompt and paste
  what was copied into a file to compare.
- C2 (UX): read the notice after the fallback and after Copy prompt.
- C3 (code quality): read `src/prompts.mjs` and its tests.
- C4 (docs): read the README's placeholder section and run its example.
