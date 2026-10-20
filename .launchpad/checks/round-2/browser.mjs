// The browser of round 2's checks: headless Chromium driven over the DevTools protocol, with Node
// built-ins only, and the small static server the test pages come from.
//
// Why not playwright-core: the gate gives a check only the tools of the base's own lockfile
// (/tools/node_modules), and this project has no dependency and no lockfile, by design. The runner image
// ships Chromium under /ms-playwright: this file starts it with --remote-debugging-pipe and speaks the
// protocol itself. The entry's code runs only in Chromium, a child process (the entry's user under the
// gate), never in the check's own process.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, sep } from "node:path";
import { ROOT, workspace } from "./lib/entry.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `fn` until it returns something truthy, which it returns; after `ms`, throws `what` (a string or an async function). */
export async function until(fn, what, ms = 3000) {
  for (const end = Date.now() + ms; ; await sleep(50)) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) throw new Error(typeof what === "function" ? await what() : what);
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

/**
 * Serves the entry's root on 127.0.0.1 as `npm run demo` does (`/` is demo/index.html), and the check's own
 * pages (`pages`, a Map of name to HTML) under /__checks__/. Only regular files inside the root are served.
 */
export function serve(pages) {
  const root = realpathSync(ROOT);
  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405).end();
    let path;
    try {
      path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      return res.writeHead(400).end();
    }
    const headers = (type) => ({ "content-type": type, "cache-control": "no-store" });
    if (path.startsWith("/__checks__/")) {
      const page = pages.get(path.slice("/__checks__/".length));
      return page === undefined ? res.writeHead(404).end("not found") : res.writeHead(200, headers(TYPES[".html"])).end(page);
    }
    try {
      const file = realpathSync(join(root, path === "/" ? "demo/index.html" : path));
      if (!file.startsWith(root + sep) || !statSync(file).isFile()) throw new Error("not served");
      res.writeHead(200, headers(TYPES[extname(file).toLowerCase()] ?? "application/octet-stream")).end(readFileSync(file));
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject).listen(0, "127.0.0.1", () => resolve({ origin: `http://127.0.0.1:${server.address().port}`, close: () => server.close() }));
  });
}

/** The runner image's Chromium (the headless shell first), or CHECKS_CHROMIUM. */
export function chromiumPath() {
  if (process.env.CHECKS_CHROMIUM) return process.env.CHECKS_CHROMIUM;
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH || "/ms-playwright";
  let names = [];
  try {
    names = readdirSync(dir).sort().reverse();
  } catch {}
  const candidates = [
    ...names.filter((n) => n.startsWith("chromium_headless_shell-")).flatMap((n) => [join(dir, n, "chrome-headless-shell-linux64", "chrome-headless-shell"), join(dir, n, "chrome-linux", "headless_shell")]),
    ...names.filter((n) => n.startsWith("chromium-")).flatMap((n) => [join(dir, n, "chrome-linux64", "chrome"), join(dir, n, "chrome-linux", "chrome")]),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`no Chromium under ${dir}: run the checks in the runner image (see run.mjs), or set CHECKS_CHROMIUM`);
  return found;
}

const FLAGS = [
  "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
  "--disable-background-networking", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding", "--disable-breakpad", "--disable-component-update", "--disable-default-apps",
  "--disable-extensions", "--disable-sync", "--disable-popup-blocking", "--disable-ipc-flooding-protection",
  "--disable-features=Translate,MediaRouter,OptimizationHints,DialMediaRouteProvider,PaintHolding",
  "--metrics-recording-only", "--mute-audio", "--hide-scrollbars", "--password-store=basic", "--use-mock-keychain",
  "--force-color-profile=srgb",
];

/** Starts Chromium with a profile any user can write (it runs as the entry's user under the gate). */
export async function launch() {
  const exe = chromiumPath();
  const { home, scratch } = workspace();
  const profile = mkdtempSync(join(scratch, "chromium-"));
  chmodSync(profile, 0o1777);
  const child = spawn(exe, [...FLAGS, `--user-data-dir=${profile}`, "--remote-debugging-pipe", "about:blank"], {
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: scratch, LANG: "C.UTF-8", TZ: "UTC" },
    stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    detached: true,
  });
  const browser = new Browser(child);
  await browser.send("Browser.getVersion", {}, undefined, 30_000);
  return browser;
}

const RECORD = "__checksRecord";
const FLUSH = "__checksFlush";

// Runs in every page before its own scripts: window.open and the clipboard only report what they were
// given (to the check, through a binding the page cannot reach afterwards), and open nothing.
const INIT = `(() => {
  const record = globalThis.${RECORD};
  delete globalThis.${RECORD};
  const say = (kind, args) => record(JSON.stringify({ kind, args: args.map((a) => (a === undefined ? null : String(a))) }));
  window.open = function open(...args) { say("open", args); return null; };
  const clipboard = {
    writeText(value) { say("writeText", [value]); return Promise.resolve(); },
    write(items) { say("write", []); return Promise.resolve(); },
    readText() { return Promise.resolve(""); },
    read() { return Promise.resolve([]); },
  };
  Object.defineProperty(Navigator.prototype, "clipboard", { get: () => clipboard, configurable: true });
})();`;

// Helpers evaluated in the page before each check's function. The element's markup is looked for in its
// light DOM and in its open shadow root (and the open shadow roots inside them), never elsewhere.
const DOM = `
const walk = (root, out = []) => { for (const el of root.children) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot, out); walk(el, out); } return out; };
const hostOf = (sel) => { const h = document.querySelector(sel); if (!h) throw new Error("no element " + sel + " on the page"); return h; };
const inside = (sel) => { const h = hostOf(sel); return [...(h.shadowRoot ? walk(h.shadowRoot) : []), ...walk(h)]; };
const all = (sel, id) => inside(sel).filter((el) => el.getAttribute("data-testid") === id);
const one = (sel, id) => all(sel, id)[0] ?? null;
const shown = (el) => { if (!el || !el.isConnected || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const active = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
const contains = (a, b) => { for (let n = b; n; n = n.parentNode ?? n.host) if (n === a) return true; return false; };
const text = (el) => (el ? el.textContent : "").replace(/\\s+/g, " ").trim();
const describe = (el) => !el ? "nothing" : el === document.body ? "<body>" : el === document.documentElement ? "<html>" : "<" + el.localName + (el.getAttribute("data-testid") ? ' data-testid="' + el.getAttribute("data-testid") + '"' : "") + ">" + (text(el) ? ' "' + text(el).slice(0, 40) + '"' : "");
const byIds = (el, attr) => { const root = el.getRootNode(); return (el.getAttribute(attr) || "").split(/\\s+/).filter(Boolean).map((id) => ({ id, el: root.getElementById(id) })); };
`;

const KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  " ": { code: "Space", keyCode: 32, text: " " },
  Escape: { code: "Escape", keyCode: 27 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  Tab: { code: "Tab", keyCode: 9 },
};

const exceptionText = (d) => (d.exception?.description ?? d.exception?.value ?? d.text ?? "an exception").split("\n").slice(0, 3).join(" ");

class Browser {
  constructor(child) {
    this.child = child;
    this.next = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.log = "";
    this.closed = null;
    child.stdio[2].on("data", (d) => (this.log = (this.log + d).slice(-4000)));
    child.stdio[3].on("error", () => {});
    let buffer = Buffer.alloc(0);
    child.stdio[4].on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (let at = buffer.indexOf(0); at >= 0; at = buffer.indexOf(0)) {
        const message = JSON.parse(buffer.subarray(0, at).toString("utf8"));
        buffer = buffer.subarray(at + 1);
        this.dispatch(message);
      }
    });
    child.on("exit", (code, signal) => {
      this.closed = `Chromium exited (${code ?? signal})`;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(`${this.closed} during ${p.method}\n${this.log.slice(-1500)}`));
      }
      this.pending.clear();
    });
    process.on("exit", () => this.close());
  }

  dispatch(m) {
    if (m.id !== undefined) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}${m.error.data ? ` (${m.error.data})` : ""}`));
      else p.resolve(m.result);
      return;
    }
    for (const h of this.handlers.get(m.sessionId ?? "") ?? []) h(m.method, m.params);
  }

  send(method, params = {}, sessionId, ms = 20_000) {
    if (this.closed) return Promise.reject(new Error(`${this.closed}: cannot ${method}\n${this.log.slice(-1500)}`));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Chromium did not answer ${method} in ${ms / 1000} s`));
      }, ms);
      this.pending.set(id, { resolve, reject, method, timer });
      this.child.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });
  }

  on(sessionId, handler) {
    if (!this.handlers.has(sessionId)) this.handlers.set(sessionId, new Set());
    this.handlers.get(sessionId).add(handler);
    return () => this.handlers.get(sessionId)?.delete(handler);
  }

  /** A new page in its own browser context (its own storage), 1280×800, served from `origin`. */
  async newPage(origin) {
    const { browserContextId } = await this.send("Target.createBrowserContext", { disposeOnDetach: true });
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this, sessionId, browserContextId, origin);
    await page.init();
    return page;
  }

  close() {
    try {
      process.kill(-this.child.pid, "SIGKILL");
    } catch {}
  }
}

class Page {
  constructor(browser, sessionId, contextId, origin) {
    Object.assign(this, { browser, sessionId, contextId, origin });
    this.calls = []; // { kind: "open" | "writeText" | "write", args }
    this.errors = []; // uncaught exceptions in the page
    this.logs = []; // console and network errors
    this.requests = []; // paths asked of the local server
    this.external = []; // anything else the page asked for (blocked)
    this.flushed = new Set();
    this.flushes = 0;
    this.loaded = null;
    this.off = browser.on(sessionId, (method, params) => this.handle(method, params));
  }

  send(method, params = {}, ms) {
    return this.browser.send(method, params, this.sessionId, ms);
  }

  async init() {
    await Promise.all([
      this.send("Page.enable"),
      this.send("Runtime.enable"),
      this.send("Log.enable"),
      this.send("Network.enable"),
      this.send("Runtime.addBinding", { name: RECORD }),
      this.send("Runtime.addBinding", { name: FLUSH }),
      this.send("Page.addScriptToEvaluateOnNewDocument", { source: INIT }),
      this.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }),
      this.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false }),
      this.send("Emulation.setFocusEmulationEnabled", { enabled: true }),
    ]);
  }

  handle(method, p) {
    if (method === "Runtime.bindingCalled") {
      if (p.name === RECORD) this.calls.push(JSON.parse(p.payload));
      else if (p.name === FLUSH) this.flushed.add(p.payload);
    } else if (method === "Fetch.requestPaused") {
      const url = p.request.url;
      if (url.startsWith(`${this.origin}/`)) {
        this.requests.push(new URL(url).pathname);
        this.send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
      } else {
        this.external.push(url);
        this.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {});
      }
    } else if (method === "Network.webSocketCreated") {
      if (!p.url.startsWith(this.origin.replace(/^http/, "ws"))) this.external.push(p.url);
    } else if (method === "Runtime.exceptionThrown") {
      this.errors.push(exceptionText(p.exceptionDetails));
    } else if (method === "Runtime.consoleAPICalled") {
      if (p.type === "error") this.logs.push(`console.error: ${p.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
    } else if (method === "Log.entryAdded") {
      if (p.entry.level === "error") this.logs.push(`${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ""}`.slice(0, 300));
    } else if (method === "Page.loadEventFired") {
      this.loaded?.();
    }
  }

  /** Loads `path` from the local server and waits for its load event. */
  async goto(path) {
    const loaded = new Promise((resolve) => (this.loaded = resolve));
    const r = await this.send("Page.navigate", { url: this.origin + path });
    if (r.errorText) throw new Error(`loading ${path}: ${r.errorText}`);
    let timer;
    await Promise.race([loaded, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${path} did not finish loading in 15 s`)), 15_000)))]).finally(() => clearTimeout(timer));
  }

  /** Runs `fn(...args)` in the page, with the DOM helpers above in scope, and returns its value (JSON). */
  async eval(fn, ...args) {
    const expression = `(async () => {${DOM}\nreturn await (${fn})(${args.map((a) => JSON.stringify(a)).join(", ")});\n})()`;
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`in the page: ${exceptionText(r.exceptionDetails)}`);
    return r.result.value;
  }

  /** A real mouse click at the centre of the host's `data-testid` element, which must be visible and on top there. */
  async click(sel, testid) {
    const p = await this.eval((sel, id) => {
      const el = one(sel, id);
      if (!el) return { error: `no data-testid="${id}" in ${sel}` };
      el.scrollIntoView({ block: "center", inline: "center" });
      if (!shown(el)) return { error: `${sel}'s data-testid="${id}" is not visible` };
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      let top = document.elementFromPoint(x, y);
      while (top && top.shadowRoot) {
        const inner = top.shadowRoot.elementFromPoint(x, y);
        if (!inner || inner === top) break;
        top = inner;
      }
      return contains(el, top) ? { x, y } : { error: `${sel}'s data-testid="${id}" cannot be clicked: ${describe(top)} covers its centre` };
    }, sel, testid);
    if (p.error) throw new Error(p.error);
    await this.mouse(p.x, p.y);
  }

  async mouse(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  }

  /** Presses and releases one key (Enter, " ", Escape, ArrowDown, ArrowUp, Tab) on whatever has the focus. */
  async press(key) {
    const k = KEYS[key];
    const base = { key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode };
    await this.send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }

  /** Resolves once every call the page made before now has reached the check. */
  async flush() {
    const token = String(++this.flushes);
    await this.send("Runtime.evaluate", { expression: `${FLUSH}(${JSON.stringify(token)})` });
    await until(() => this.flushed.has(token), "the page stopped answering", 5000);
  }

  async close() {
    this.off();
    await this.browser.send("Target.disposeBrowserContext", { browserContextId: this.contextId }).catch(() => {});
  }
}
