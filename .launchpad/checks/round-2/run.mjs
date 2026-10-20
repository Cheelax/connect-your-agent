// Round 2's checks: the <connect-agent> button and its picker (ARCHITECTURE.md, "The button", and round 2's
// brief in .launchpad/project.md), in headless Chromium, on test pages that load the entry's
// src/connect-agent.mjs from a static server on 127.0.0.1. Run them from the repository's root, in the
// runner image, which has the Chromium they drive (see browser.mjs):
//   podman run --rm --network none -v "$PWD:/w:Z" -w /w mcr.microsoft.com/playwright@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 node .launchpad/checks/round-2/run.mjs
//
// The expected links come from the frozen catalogue below (round 1's table), never from the entry's
// src/harnesses.mjs: the entry's code runs only in Chromium, and round 1's checks, run again in this round,
// hold linkFor to the same table. window.open and navigator.clipboard are replaced in every page before its
// own scripts run: they report what they were given and open nothing.
//
// Later rounds run these checks again. Each choice of an agent happens on a fresh page (round 3 remembers
// the chosen agent), and the prompts hold no {{placeholder}} (round 4). Round 4 makes an agent over the
// limit choosable again (a copy, then the agent's home): its checks will have to replace the two tests on
// the 8,000-character limit.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { check, harness } from "./lib/harness.mjs";
import { ROOT } from "./lib/entry.mjs";
import { launch, serve, sleep, until } from "./browser.mjs";

const { test, done } = harness();

const AGENTS = [
  { id: "claude", name: "Claude", kind: "url", base: "https://claude.ai/new?q=" },
  { id: "chatgpt", name: "ChatGPT", kind: "url", base: "https://chatgpt.com/?q=" },
  { id: "perplexity", name: "Perplexity", kind: "url", base: "https://www.perplexity.ai/search?q=" },
  { id: "le-chat", name: "Le Chat", kind: "url", base: "https://chat.mistral.ai/chat?q=" },
  { id: "cursor", name: "Cursor", kind: "deeplink", base: "cursor://anysphere.cursor-deeplink/prompt?text=" },
  { id: "claude-code", name: "Claude Code", kind: "command", base: "claude " },
  { id: "codex", name: "Codex CLI", kind: "command", base: "codex " },
];
const IDS = AGENTS.map((a) => a.id);
const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
const MAX_LINK_LENGTH = 8000;
const DEFAULT_LABEL = "Connect your agent";

const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const linkOf = (id, prompt) => byId[id].base + (byId[id].kind === "command" ? quote(prompt) : encodeURIComponent(prompt));
const tooLong = (id, prompt) => byId[id].kind !== "command" && linkOf(id, prompt).length > MAX_LINK_LENGTH;
const show = (v) => (v === null || v === undefined ? String(v) : JSON.stringify(v.length > 160 ? `${v.slice(0, 160)}… (${v.length} characters)` : v));
const showCalls = (calls) => (calls.length ? calls.map((c) => `${c.kind}(${c.args.map(show).join(", ")})`).join("; ") : "no call");

// A prompt with what a link must encode and a command must quote, and no {{placeholder}}.
const PROMPT = "Explain this page: \"Café 🚀\" & it's #1\nthen a+b=c, 100% sure?";

// The test pages: each loads the module from the entry's src/, as the brief's snippet does.
const pages = new Map();
const attr = (v) => String(v).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
/** A page with these elements, `{ id, prompt?, label? }`, far enough apart for a picker under each button. */
function fixture(elements) {
  const name = `page-${pages.size + 1}.html`;
  const tag = (e) => `<connect-agent id="${e.id}"${e.prompt === undefined ? "" : ` prompt="${attr(e.prompt)}"`}${e.label === undefined ? "" : ` label="${attr(e.label)}"`}></connect-agent>`;
  pages.set(name, `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Round 2 checks</title>
<script type="module" src="/src/connect-agent.mjs"></script>
</head>
<body style="margin:0;min-height:100vh;font:16px/1.4 sans-serif">
<main style="padding:24px 24px 600px">
${elements.map((e) => `<section style="margin:0 0 480px">${tag(e)}</section>`).join("\n")}
</main>
</body>
</html>
`);
  return `/__checks__/${name}`;
}

const server = await serve(pages);
let browser;

/** Runs `fn(page)` on a fresh page (its own browser context) at `path`; page errors are added to a failure. */
async function onPage(path, fn) {
  if (!browser || browser.closed) browser = await launch();
  const page = await browser.newPage(server.origin);
  try {
    await page.goto(path);
    return await fn(page);
  } catch (e) {
    const extra = [...page.errors.map((x) => `uncaught in the page: ${x}`), ...page.logs].slice(0, 6);
    throw new Error(extra.length ? `${e.message}\n${extra.join("\n")}` : e.message);
  } finally {
    await page.close();
  }
}

/** A test with a time limit, so that a page that hangs fails its test and not the run. */
function t(name, fn, ms = 60_000) {
  return test(name, async () => {
    let timer;
    try {
      await Promise.race([fn(), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`the test did not finish in ${ms / 1000} s`)), ms)))]);
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Waits until the module defined connect-agent and each host rendered its data-testid="connect-button". */
async function ready(p, hosts = ["#a"]) {
  check(existsSync(join(ROOT, "src/connect-agent.mjs")), "src/connect-agent.mjs does not exist");
  await until(() => p.eval(() => !!customElements.get("connect-agent")), "the page loaded src/connect-agent.mjs, but no custom element connect-agent was defined", 5000);
  for (const h of hosts) {
    await until(() => p.eval((h) => !!one(h, "connect-button"), h), () => p.eval((h) => {
      const el = document.querySelector(h);
      return `${h} has no data-testid="connect-button" in its light DOM or its open shadow root (${el.shadowRoot ? "it has an open shadow root" : "it has no open shadow root: a closed one hides its markup from the page"})`;
    }, h), 3000);
  }
}

const pickerShown = (p, h) => p.eval((h) => shown(one(h, "picker")), h);
async function openPicker(p, h = "#a") {
  await p.click(h, "connect-button");
  await until(() => pickerShown(p, h), `${h}: clicking data-testid="connect-button" did not show its data-testid="picker"`);
}
async function pickerClosed(p, h, after) {
  await until(async () => !(await pickerShown(p, h)), `${h}: the picker is still shown ${after}`);
}
async function focusOn(p, h, id, after) {
  await until(() => p.eval((h, id) => { const el = one(h, id); return !!el && active() === el; }, h, id),
    async () => `${after}, the focus is on ${await p.eval(() => describe(active()))}, expected ${h}'s data-testid="${id}"`, 2000);
}
const focus = (p, h, id) => p.eval((h, id) => { const el = one(h, id); el?.focus(); return !!el && active() === el; }, h, id);

/** The window.open and clipboard calls made while `action` runs, once they have all reached the check. */
async function callsOf(p, action, expected = 1) {
  const before = p.calls.length;
  await action();
  if (expected) await until(() => p.calls.length - before >= expected, "", 2000).catch(() => {});
  await sleep(expected ? 250 : 500);
  await p.flush();
  return p.calls.slice(before);
}
function opens(calls, id, prompt, what) {
  const want = linkOf(id, prompt);
  check(calls.length === 1 && calls[0].kind === "open", `${what}: expected one window.open(${show(want)}, "_blank"), got ${showCalls(calls)}`);
  check(calls[0].args[0] === want, `${what}: window.open got\n  ${show(calls[0].args[0])}\nexpected linkFor's value\n  ${show(want)}`);
  check(calls[0].args[1] === "_blank", `${what}: window.open's second argument is ${show(calls[0].args[1])}, expected "_blank"`);
}
function copies(calls, id, prompt, what) {
  const want = linkOf(id, prompt);
  check(calls.length === 1 && calls[0].kind === "writeText", `${what}: expected one navigator.clipboard.writeText(${show(want)}), got ${showCalls(calls)}`);
  check(calls[0].args[0] === want, `${what}: navigator.clipboard.writeText got\n  ${show(calls[0].args[0])}\nexpected linkFor's value\n  ${show(want)}`);
}
const nothing = (calls, what) => check(calls.length === 0, `${what}: expected no window.open and no clipboard write, got ${showCalls(calls)}`);

/** The agent rows of a host, in document order: `{ id, tag, text, inPicker, shown, disabled, reason }`. */
const rows = (p, h) => p.eval((h) => {
  const picker = one(h, "picker");
  const agentRows = inside(h).filter((el) => /^agent-/.test(el.getAttribute("data-testid") || ""));
  return agentRows.map((el) => {
    const parts = [text(el), el.getAttribute("title"), el.getAttribute("aria-description"), el.getAttribute("aria-label"),
      ...byIds(el, "aria-describedby").map((r) => text(r.el))];
    // A reason next to the button, in its own row, counts too.
    const row = el.parentElement;
    if (row && row !== picker && row.querySelectorAll('[data-testid^="agent-"]').length === 1) parts.push(text(row));
    return { id: el.getAttribute("data-testid").slice("agent-".length), tag: el.localName, text: text(el), inPicker: !!picker && contains(picker, el),
      shown: shown(el), disabled: el.getAttribute("aria-disabled"), reason: parts.filter(Boolean).join(" ") };
  });
}, h);
const REASON = /too long|limit|8[,.\s  ]?000|characters|exceed|shorten/i;

// 1
await t("src/connect-agent.mjs loads as a module with no error and defines the custom element connect-agent", () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    const element = await p.eval(() => { const el = document.querySelector("#a"); const C = customElements.get("connect-agent"); return { upgraded: el instanceof C, html: el instanceof HTMLElement }; });
    check(element.upgraded && element.html, "<connect-agent> on the page is not an instance of the class defined for connect-agent");
    await sleep(200);
    check(p.errors.length === 0, `the page threw: ${p.errors.join("; ")}`);
  }));

// 2
await t("the module builds its links with round 1's core: loading it loads /src/harnesses.mjs", () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    check(p.requests.includes("/src/connect-agent.mjs"), `the page did not load /src/connect-agent.mjs (it asked for ${p.requests.join(", ")})`);
    check(p.requests.includes("/src/harnesses.mjs"), `loading /src/connect-agent.mjs did not load /src/harnesses.mjs: it must import linkFor from "./harnesses.mjs" (the page asked for ${p.requests.join(", ")})`);
  }));

// 3
await t("the element's markup is in its light DOM or its open shadow root", () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    const where = await p.eval(() => {
      const el = document.querySelector("#a");
      const b = one("#a", "connect-button");
      return { open: !!el.shadowRoot, light: contains(el, b) && b.getRootNode() === document };
    });
    check(where.open || where.light, "the button is neither in the element's light DOM nor in its open shadow root");
  }));

// 4
await t(`the button is a <button> data-testid="connect-button" reading "${DEFAULT_LABEL}" by default, or the label attribute`, () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }, { id: "b", prompt: PROMPT, label: "Ask your AI" }]), async (p) => {
    await ready(p, ["#a", "#b"]);
    for (const [h, label, not] of [["#a", DEFAULT_LABEL, null], ["#b", "Ask your AI", DEFAULT_LABEL]]) {
      const b = await p.eval((h) => { const el = one(h, "connect-button"); return { tag: el.localName, text: text(el), shown: shown(el) }; }, h);
      check(b.tag === "button", `${h}'s data-testid="connect-button" is a <${b.tag}>, expected a <button>`);
      check(b.shown, `${h}'s button is not visible`);
      check(b.text.includes(label), `${h}'s button reads ${show(b.text)}, expected ${show(label)}`);
      if (not) check(!b.text.includes(not), `${h}'s button reads ${show(b.text)}: with label="${label}" it must not read ${show(not)}`);
    }
  }));

// 5
await t("the button is disabled with no prompt, an empty prompt or a whitespace-only one, and enabled with a real one", () =>
  onPage(fixture([{ id: "a" }, { id: "b", prompt: "" }, { id: "c", prompt: "  \n\t " }, { id: "d", prompt: " x " }]), async (p) => {
    await ready(p, ["#a", "#b", "#c", "#d"]);
    for (const [h, what, disabled] of [["#a", "no prompt attribute", true], ["#b", 'prompt=""', true], ["#c", "a whitespace-only prompt", true], ["#d", 'prompt=" x "', false]]) {
      const b = await p.eval((h) => { const el = one(h, "connect-button"); return { tag: el.localName, disabled: el.disabled === true }; }, h);
      check(b.tag === "button", `${h}'s data-testid="connect-button" is a <${b.tag}>, expected a <button>`);
      check(b.disabled === disabled, `with ${what}, the button is ${b.disabled ? "" : "not "}disabled; expected it ${disabled ? "disabled" : "enabled"}`);
    }
  }));

// 6
await t(`changing the label attribute changes the button's text, and removing it brings back "${DEFAULT_LABEL}"`, () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    const reads = () => p.eval(() => text(one("#a", "connect-button")));
    await p.eval(() => document.querySelector("#a").setAttribute("label", "Ask your AI"));
    await until(async () => { const s = await reads(); return s.includes("Ask your AI") && !s.includes("Connect your agent"); },
      async () => `after setAttribute("label", "Ask your AI"), the button reads ${show(await reads())}`, 2000);
    await p.eval(() => document.querySelector("#a").setAttribute("label", "Open with AI"));
    await until(async () => (await reads()).includes("Open with AI"), async () => `after setAttribute("label", "Open with AI"), the button reads ${show(await reads())}`, 2000);
    await p.eval(() => document.querySelector("#a").removeAttribute("label"));
    await until(async () => (await reads()).includes(DEFAULT_LABEL), async () => `after removeAttribute("label"), the button reads ${show(await reads())}, expected ${show(DEFAULT_LABEL)}`, 2000);
  }));

// 7
await t("changing the prompt attribute updates the element: its disabled state, then the link it opens", async () => {
  const disabled = (p, h) => p.eval((h) => one(h, "connect-button").disabled === true, h);
  await onPage(fixture([{ id: "a", prompt: "first prompt" }]), async (p) => {
    await ready(p);
    check(!(await disabled(p, "#a")), "with a prompt, the button is disabled");
    await p.eval(() => document.querySelector("#a").setAttribute("prompt", "  \n "));
    await until(() => disabled(p, "#a"), 'after setAttribute("prompt", "  \\n "), the button is still enabled', 2000);
    await p.eval(() => document.querySelector("#a").setAttribute("prompt", "second prompt"));
    await until(async () => !(await disabled(p, "#a")), 'after setAttribute("prompt", "second prompt"), the button is still disabled', 2000);
    await p.eval(() => document.querySelector("#a").removeAttribute("prompt"));
    await until(() => disabled(p, "#a"), 'after removeAttribute("prompt"), the button is still enabled', 2000);
    await p.eval(() => document.querySelector("#a").setAttribute("prompt", "third prompt"));
    await until(async () => !(await disabled(p, "#a")), 'after setAttribute("prompt", "third prompt"), the button is still disabled', 2000);
    await openPicker(p);
    opens(await callsOf(p, () => p.click("#a", "agent-claude")), "claude", "third prompt", 'choosing Claude after setAttribute("prompt", "third prompt")');
  });
  // An element made by a script, its prompt set once it is on the page.
  await onPage(fixture([]), async (p) => {
    await until(() => p.eval(() => !!customElements.get("connect-agent")), "no custom element connect-agent was defined", 5000);
    await p.eval(() => { const el = document.createElement("connect-agent"); el.id = "s"; document.querySelector("main").prepend(el); el.setAttribute("prompt", "made by a script"); });
    await ready(p, ["#s"]);
    await until(async () => !(await disabled(p, "#s")), "an element made with document.createElement, then given a prompt, has its button disabled", 2000);
    await openPicker(p, "#s");
    opens(await callsOf(p, () => p.click("#s", "agent-chatgpt")), "chatgpt", "made by a script", "choosing ChatGPT on an element made by a script");
  });
});

// 8
await t('clicking the button opens the picker: data-testid="picker", not shown before, role="dialog", aria-modal="true", labelled', () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    await sleep(200);
    check(!(await pickerShown(p, "#a")), "the picker is shown before the button is clicked");
    await openPicker(p);
    const d = await p.eval(() => {
      const el = one("#a", "picker");
      const label = (el.getAttribute("aria-label") || "").trim() || byIds(el, "aria-labelledby").map((r) => text(r.el)).join(" ").trim();
      return { tag: el.localName, role: el.getAttribute("role"), modal: el.getAttribute("aria-modal"), label };
    });
    check(d.role === "dialog" || (d.tag === "dialog" && d.role === null), `the picker's role is ${show(d.role)}, expected "dialog"`);
    check(d.modal === "true", `the picker's aria-modal is ${show(d.modal)}, expected "true"`);
    check(d.label !== "", "the picker has no label: give it an aria-label, or an aria-labelledby that points to its title");
  }));

// 9
await t('the picker shows the seven agents in catalogue order, each a <button> data-testid="agent-<id>" showing its name', () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    await openPicker(p);
    const found = (await rows(p, "#a")).filter((r) => IDS.includes(r.id));
    const order = found.map((r) => r.id).join(", ");
    check(order === IDS.join(", "), `the picker's data-testid="agent-<id>" are ${order || "none"}; expected ${IDS.join(", ")}, once each`);
    for (const r of found) {
      check(r.tag === "button", `data-testid="agent-${r.id}" is a <${r.tag}>, expected a <button>`);
      check(r.inPicker, `data-testid="agent-${r.id}" is not inside data-testid="picker"`);
      check(r.shown, `data-testid="agent-${r.id}" is not visible while the picker is open`);
      check(r.text.includes(byId[r.id].name), `data-testid="agent-${r.id}" reads ${show(r.text)}, expected the name ${show(byId[r.id].name)}`);
    }
  }));

// 10
await t('the close control data-testid="picker-close" closes the picker, and the focus returns to the button', () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    await openPicker(p);
    const calls = await callsOf(p, () => p.click("#a", "picker-close"), 0);
    await pickerClosed(p, "#a", 'after a click on data-testid="picker-close"');
    nothing(calls, "closing the picker");
    await focusOn(p, "#a", "connect-button", 'after a click on data-testid="picker-close"');
  }));

// 11
await t('choosing Claude, ChatGPT, Perplexity, Le Chat or Cursor closes the picker and calls window.open(link, "_blank") once, with linkFor\'s value', async () => {
  for (const a of AGENTS.filter((a) => a.kind !== "command")) {
    await onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
      await ready(p);
      await openPicker(p);
      const calls = await callsOf(p, () => p.click("#a", `agent-${a.id}`));
      await pickerClosed(p, "#a", `after choosing ${a.name}`);
      opens(calls, a.id, PROMPT, `choosing ${a.name}`);
    });
  }
});

// 12
await t('choosing Claude Code or Codex CLI closes the picker, copies the command with navigator.clipboard.writeText, and a role="status" notice says it was copied and to paste it in a terminal', async () => {
  for (const a of AGENTS.filter((a) => a.kind === "command")) {
    await onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
      await ready(p);
      await openPicker(p);
      const calls = await callsOf(p, () => p.click("#a", `agent-${a.id}`));
      await pickerClosed(p, "#a", `after choosing ${a.name}`);
      copies(calls, a.id, PROMPT, `choosing ${a.name}`);
      const n = await until(() => p.eval(() => { const el = one("#a", "notice"); return el && shown(el) && text(el) ? { tag: el.localName, role: el.getAttribute("role"), text: text(el) } : null; }),
        `after choosing ${a.name}, no visible data-testid="notice" with a message in the element`, 2000);
      check(n.role === "status" || (n.tag === "output" && n.role === null), `the notice's role is ${show(n.role)}, expected "status"`);
      check(/cop(y|ied)/i.test(n.text), `the notice reads ${show(n.text)}: it must say the command was copied`);
      check(/terminal|shell|command[ -]line|console|\bcli\b/i.test(n.text), `the notice reads ${show(n.text)}: it must say where to paste it (a terminal)`);
    });
  }
});

// 13
await t('an agent whose link would be over 8,000 characters is shown with aria-disabled="true" and the reason, and choosing it does nothing', () => {
  const prompt = "a".repeat(7960); // Cursor's deeplink: 8,007 characters; every other link fits
  return onPage(fixture([{ id: "a", prompt }]), async (p) => {
    await ready(p);
    await openPicker(p);
    const found = Object.fromEntries((await rows(p, "#a")).map((r) => [r.id, r]));
    check(found.cursor, 'with a long prompt, data-testid="agent-cursor" is not in the picker: it must be shown');
    check(found.cursor.shown, "with a long prompt, Cursor is not visible: it must be shown, not choosable");
    check(found.cursor.disabled === "true", `Cursor's link would be ${linkOf("cursor", prompt).length} characters, and its row has aria-disabled=${show(found.cursor.disabled)}, expected "true"`);
    check(REASON.test(found.cursor.reason), `Cursor's row gives no reason for being disabled (it reads ${show(found.cursor.reason)}): say that the prompt is too long for its link`);
    for (const id of IDS.filter((id) => id !== "cursor")) check(found[id]?.disabled !== "true", `${byId[id].name}'s link fits (${linkOf(id, prompt).length} characters) but its row has aria-disabled="true"`);
    nothing(await callsOf(p, () => p.click("#a", "agent-cursor"), 0), "a click on Cursor, over the limit");
    if (!(await pickerShown(p, "#a"))) await openPicker(p);
    if (await focus(p, "#a", "agent-cursor")) {
      nothing(await callsOf(p, () => p.press("Enter"), 0), "Enter on Cursor, over the limit");
      if (!(await pickerShown(p, "#a"))) await openPicker(p);
      if (await focus(p, "#a", "agent-cursor")) nothing(await callsOf(p, () => p.press(" "), 0), "Space on Cursor, over the limit");
    }
    if (!(await pickerShown(p, "#a"))) await openPicker(p);
    opens(await callsOf(p, () => p.click("#a", "agent-claude")), "claude", prompt, "then choosing Claude, whose link fits");
  });
});

// 14
await t("the limit is measured on the encoded link: exactly 8,000 characters can be chosen, 8,001 cannot, and commands never reach it", async () => {
  const cases = [
    { prompt: "a".repeat(7977), choose: "chatgpt", what: "a link of exactly 8,000 characters (ChatGPT), and 8,001 (Claude)" },
    { prompt: "é".repeat(1326), choose: "le-chat", what: "1,326 × é, 7,956 characters once encoded (Cursor: 8,003)" },
    { prompt: "x".repeat(20_000), choose: "codex", what: "a 20,000-character prompt (every link is over, no command is)" },
    { prompt: "é".repeat(1326), choose: "perplexity", what: "a prompt set after the page loaded, 1,326 × é", later: true },
  ];
  for (const c of cases) {
    await onPage(fixture([{ id: "a", prompt: c.later ? "short" : c.prompt }]), async (p) => {
      await ready(p);
      if (c.later) await p.eval((v) => document.querySelector("#a").setAttribute("prompt", v), c.prompt);
      await openPicker(p);
      const found = Object.fromEntries((await rows(p, "#a")).map((r) => [r.id, r]));
      for (const id of IDS) {
        const over = tooLong(id, c.prompt);
        check(found[id], `with ${c.what}, data-testid="agent-${id}" is not in the picker`);
        check((found[id].disabled === "true") === over,
          `with ${c.what}, ${byId[id].name}'s ${byId[id].kind} would be ${linkOf(id, c.prompt).length} characters: aria-disabled is ${show(found[id].disabled)}, expected ${over ? '"true"' : 'not "true"'}`);
      }
      const calls = await callsOf(p, () => p.click("#a", `agent-${c.choose}`));
      if (byId[c.choose].kind === "command") copies(calls, c.choose, c.prompt, `with ${c.what}, choosing ${byId[c.choose].name}`);
      else opens(calls, c.choose, c.prompt, `with ${c.what}, choosing ${byId[c.choose].name}`);
    });
  }
});

// 15
await t("opening the picker moves the focus to the first agent, Claude, whether it is opened by a click or from the keyboard", async () => {
  await onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    await openPicker(p);
    await focusOn(p, "#a", "agent-claude", "after a click opens the picker");
  });
  for (const key of ["Enter", " "]) {
    await onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
      await ready(p);
      check(await focus(p, "#a", "connect-button"), "the button cannot take the focus");
      await p.press(key);
      await until(() => pickerShown(p, "#a"), `${key === " " ? "Space" : key} on the focused button did not open the picker`);
      await focusOn(p, "#a", "agent-claude", `after ${key === " " ? "Space" : key} on the button opens the picker`);
    });
  }
});

// 16
await t("ArrowDown and ArrowUp move the focus from agent to agent, wrapping at both ends", () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    await openPicker(p);
    await focusOn(p, "#a", "agent-claude", "after the picker opens");
    // Round 4's last row, data-testid="copy-prompt", may sit between the last agent and the first.
    const step = async (key, id, from) => {
      await p.press(key);
      const extra = await p.eval(() => active()?.getAttribute("data-testid") === "copy-prompt");
      if (extra) await p.press(key);
      await focusOn(p, "#a", `agent-${id}`, `after ${key} from ${byId[from].name}`);
    };
    for (let i = 1; i < IDS.length; i++) await step("ArrowDown", IDS[i], IDS[i - 1]);
    await step("ArrowDown", "claude", "codex");
    await step("ArrowUp", "codex", "claude");
    for (let i = IDS.length - 2; i >= 0; i--) await step("ArrowUp", IDS[i], IDS[i + 1]);
  }));

// 17
await t("Enter and Space on a focused agent choose it, once, then the picker closes and the focus returns to the button", async () => {
  for (const [key, id] of [["Enter", "chatgpt"], [" ", "claude-code"], ["Enter", "codex"], [" ", "perplexity"]]) {
    const name = key === " " ? "Space" : key;
    await onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
      await ready(p);
      await openPicker(p);
      check(await focus(p, "#a", `agent-${id}`), `data-testid="agent-${id}" cannot take the focus`);
      const calls = await callsOf(p, () => p.press(key));
      if (byId[id].kind === "command") copies(calls, id, PROMPT, `${name} on ${byId[id].name}`);
      else opens(calls, id, PROMPT, `${name} on ${byId[id].name}`);
      await pickerClosed(p, "#a", `after ${name} on ${byId[id].name}`);
      await focusOn(p, "#a", "connect-button", `after ${name} on ${byId[id].name}`);
    });
  }
});

// 18
await t("Escape closes the picker without choosing, and the focus returns to the button", () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    await openPicker(p);
    check(await focus(p, "#a", "agent-le-chat"), 'data-testid="agent-le-chat" cannot take the focus');
    const calls = await callsOf(p, () => p.press("Escape"), 0);
    await pickerClosed(p, "#a", "after Escape");
    nothing(calls, "Escape");
    await focusOn(p, "#a", "connect-button", "after Escape");
  }));

// 19
await t("a click outside the picker closes it without choosing an agent", () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    await openPicker(p);
    const at = await p.eval(() => {
      const box = (el) => el.getBoundingClientRect();
      const [picker, button] = [box(one("#a", "picker")), box(one("#a", "connect-button"))];
      const out = (r, x, y) => x < r.left - 4 || x > r.right + 4 || y < r.top - 4 || y > r.bottom + 4;
      const w = innerWidth, h = innerHeight;
      return [[w - 8, h - 8], [w - 8, 8], [8, h - 8], [w / 2, h - 8], [8, 8]].find(([x, y]) => out(picker, x, y) && out(button, x, y)) ?? null;
    });
    check(at, "the picker covers the whole page: there is nowhere outside it to click");
    const calls = await callsOf(p, () => p.mouse(at[0], at[1]), 0);
    await pickerClosed(p, "#a", `after a click outside it, at (${Math.round(at[0])}, ${Math.round(at[1])})`);
    nothing(calls, "a click outside the picker");
  }));

// 20
await t("two <connect-agent> on one page work independently: each has its own picker, prompt, notice and ARIA references", () =>
  onPage(fixture([{ id: "a", prompt: "the first prompt", label: "First" }, { id: "b", prompt: "the second prompt" }]), async (p) => {
    await ready(p, ["#a", "#b"]);
    const refsInside = (h) => p.eval((h) => {
      const bad = [];
      for (const el of inside(h)) for (const a of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
        for (const r of byIds(el, a)) if (!r.el || !contains(document.querySelector(h), r.el)) bad.push(`${describe(el)} ${a}="${r.id}" points ${r.el ? "into another element" : "nowhere"}`);
      }
      return bad;
    }, h);
    const texts = await p.eval(() => [text(one("#a", "connect-button")), text(one("#b", "connect-button"))]);
    check(texts[0].includes("First") && texts[1].includes(DEFAULT_LABEL), `the two buttons read ${show(texts[0])} and ${show(texts[1])}, expected "First" and ${show(DEFAULT_LABEL)}`);
    for (const [h, other] of [["#b", "#a"], ["#a", "#b"]]) {
      await openPicker(p, h);
      check(!(await pickerShown(p, other)), `opening ${h}'s picker also showed ${other}'s`);
      const bad = await refsInside(h);
      check(bad.length === 0, `in ${h}, with its picker open: ${bad.join("; ")}: ids must be unique to each element`);
      if (h === "#b") {
        await p.click("#b", "picker-close");
        await pickerClosed(p, "#b", 'after a click on its data-testid="picker-close"');
      }
    }
    copies(await callsOf(p, () => p.click("#a", "agent-codex")), "codex", "the first prompt", "choosing Codex CLI in the first element");
    await until(() => p.eval(() => { const n = one("#a", "notice"); return n && shown(n) && text(n) !== ""; }), "after choosing Codex CLI in the first element, its notice shows no message", 2000);
    const second = await p.eval(() => { const n = one("#b", "notice"); return n && shown(n) ? text(n) : ""; });
    check(second === "", `choosing Codex CLI in the first element put a message in the second one's notice: ${show(second)}`);
  }));

// 21
await t("the button loads nothing but the local server: no request to another host while it is used", () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    await openPicker(p);
    await p.click("#a", "picker-close");
    await pickerClosed(p, "#a", 'after a click on data-testid="picker-close"');
    await openPicker(p);
    await callsOf(p, () => p.click("#a", "agent-claude-code"));
    await sleep(300);
    check(p.external.length === 0, `the page asked another host for ${[...new Set(p.external)].slice(0, 5).map(show).join(", ")}: the button must work offline, with nothing but its own files`);
  }));

// 22
await t("the button has no dependency: package.json declares none and the page loads nothing from node_modules", () =>
  onPage(fixture([{ id: "a", prompt: PROMPT }]), async (p) => {
    await ready(p);
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    } catch (e) {
      throw new Error(`package.json cannot be read: ${e.message}`);
    }
    for (const k of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"]) {
      const v = pkg[k];
      check(!v || (Array.isArray(v) ? v : Object.keys(v)).length === 0, `package.json declares ${k}: ${JSON.stringify(v)}; the button is plain JavaScript, with no dependency`);
    }
    const fromModules = p.requests.filter((r) => r.includes("/node_modules/"));
    check(fromModules.length === 0, `the page loaded ${fromModules.join(", ")}`);
  }));

// 23
await t("demo/index.html, which npm run demo serves, shows a <connect-agent> with a prompt whose button opens the picker", () =>
  onPage("/", async (p) => {
    await until(() => p.eval(() => !!customElements.get("connect-agent")), "demo/index.html (served at /) defines no connect-agent: it must load /src/connect-agent.mjs", 5000);
    const found = await until(() => p.eval(() => {
      let n = 0;
      for (const el of document.querySelectorAll("connect-agent")) {
        if (!el.id) el.id = `checks-demo-${++n}`;
        const sel = `#${CSS.escape(el.id)}`;
        const b = one(sel, "connect-button");
        if (b && !b.disabled && shown(b)) return sel;
      }
      return null;
    }), "demo/index.html shows no <connect-agent> with a prompt and an enabled button", 3000);
    await openPicker(p, found);
    const agentRows = (await rows(p, found)).filter((r) => IDS.includes(r.id) && r.shown);
    check(agentRows.length > 0, `the demo's picker (${found}) shows no agent`);
    check(p.requests.includes("/src/connect-agent.mjs"), `the demo did not load /src/connect-agent.mjs (it asked for ${p.requests.join(", ")})`);
    check(p.errors.length === 0, `the demo threw: ${p.errors.join("; ")}`);
  }));

browser?.close();
server.close();
done();
