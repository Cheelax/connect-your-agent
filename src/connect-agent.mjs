import { agents, linkFor } from "./harnesses.mjs";

const DEFAULT_LABEL = "Connect your agent";
let nextInstance = 0;

const styles = `
  :host {
    --connect-agent-accent: #6d5ce7;
    --connect-agent-accent-strong: #5543cf;
    --connect-agent-bg: #ffffff;
    --connect-agent-fg: #17151f;
    --connect-agent-muted: #666271;
    --connect-agent-border: color-mix(in srgb, var(--connect-agent-fg) 15%, transparent);
    --connect-agent-shadow: 0 18px 48px rgba(35, 27, 76, .18), 0 2px 8px rgba(35, 27, 76, .08);
    --connect-agent-radius: 16px;
    --connect-agent-font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    display: inline-block;
    position: relative;
    color: var(--connect-agent-fg);
    font-family: var(--connect-agent-font);
    font-size: 15px;
    line-height: 1.35;
  }

  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }

  .connect {
    appearance: none;
    border: 0;
    border-radius: 999px;
    background: var(--connect-agent-accent);
    color: white;
    cursor: pointer;
    font: 700 15px/1 var(--connect-agent-font);
    min-height: 44px;
    padding: 0 20px;
    box-shadow: 0 8px 20px color-mix(in srgb, var(--connect-agent-accent) 25%, transparent);
    transition: background .16s ease, box-shadow .16s ease, transform .16s ease;
  }

  .connect:hover { background: var(--connect-agent-accent-strong); transform: translateY(-1px); }
  .connect:active { transform: translateY(0); }
  .connect:disabled { cursor: not-allowed; opacity: .48; box-shadow: none; transform: none; }
  button:focus-visible { outline: 3px solid color-mix(in srgb, var(--connect-agent-accent) 42%, transparent); outline-offset: 3px; }

  .picker {
    position: absolute;
    z-index: 2147483000;
    inset-block-start: calc(100% + 10px);
    inset-inline-start: 0;
    width: min(340px, calc(100vw - 24px));
    max-height: min(520px, calc(100vh - 32px));
    overflow: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--connect-agent-border);
    border-radius: var(--connect-agent-radius);
    background: var(--connect-agent-bg);
    color: var(--connect-agent-fg);
    box-shadow: var(--connect-agent-shadow);
    padding: 10px;
  }

  .heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 4px 10px 10px; }
  .title { font-size: 14px; font-weight: 800; letter-spacing: -.01em; }
  .close {
    appearance: none;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--connect-agent-muted);
    cursor: pointer;
    font: 24px/1 var(--connect-agent-font);
  }
  .close:hover { background: color-mix(in srgb, var(--connect-agent-fg) 7%, transparent); color: var(--connect-agent-fg); }

  .agents { display: grid; gap: 4px; }
  .agent {
    appearance: none;
    width: 100%;
    min-height: 50px;
    border: 0;
    border-radius: 11px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    align-items: center;
    gap: 11px;
    padding: 7px 10px;
    text-align: start;
    font: inherit;
  }
  .agent:hover, .agent:focus-visible { background: color-mix(in srgb, var(--connect-agent-accent) 9%, transparent); }
  .agent[aria-disabled="true"] { cursor: not-allowed; opacity: .5; }
  .agent[aria-disabled="true"]:hover { background: transparent; }
  .mark { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: color-mix(in srgb, var(--connect-agent-accent) 13%, transparent); color: var(--connect-agent-accent); font-size: 13px; font-weight: 850; }
  .name { min-width: 0; font-weight: 720; }
  .action { color: var(--connect-agent-muted); font-size: 12px; }
  .reason { grid-column: 2 / -1; color: var(--connect-agent-muted); font-size: 12px; margin-top: -5px; }
  .notice { max-width: 340px; margin-top: 9px; color: var(--connect-agent-muted); font-size: 13px; }

  @media (prefers-color-scheme: dark) {
    :host { --connect-agent-bg: #211e2a; --connect-agent-fg: #f7f5ff; --connect-agent-muted: #b8b3c4; --connect-agent-shadow: 0 20px 56px rgba(0, 0, 0, .48); }
  }
  @media (max-width: 375px) { .picker { width: min(326px, calc(100vw - 16px)); inset-inline-start: 0; } }
  @media (prefers-reduced-motion: reduce) { .connect { transition: none; } }
`;

export class ConnectAgent extends HTMLElement {
  static observedAttributes = ["prompt", "label"];

  constructor() {
    super();
    this.instance = ++nextInstance;
    this.open = false;
    this.root = this.attachShadow({ mode: "open" });
    this.root.innerHTML = `
      <style>${styles}</style>
      <button class="connect" part="button" type="button" data-testid="connect-button" aria-haspopup="dialog"></button>
      <section class="picker" part="picker" data-testid="picker" role="dialog" aria-modal="true" hidden>
        <div class="heading">
          <div class="title"></div>
          <button class="close" type="button" data-testid="picker-close" aria-label="Close agent picker">×</button>
        </div>
        <div class="agents"></div>
      </section>
      <div class="notice" data-testid="notice" role="status" aria-live="polite" hidden></div>
    `;
    this.button = this.root.querySelector(".connect");
    this.picker = this.root.querySelector(".picker");
    this.titleElement = this.root.querySelector(".title");
    this.list = this.root.querySelector(".agents");
    this.notice = this.root.querySelector(".notice");
    this.closeControl = this.root.querySelector(".close");
    this.pickerId = `connect-agent-picker-${this.instance}`;
    this.titleId = `connect-agent-title-${this.instance}`;
    this.picker.id = this.pickerId;
    this.titleElement.id = this.titleId;
    this.picker.setAttribute("aria-labelledby", this.titleId);
    this.button.setAttribute("aria-controls", this.pickerId);

    this.button.addEventListener("click", () => this.showPicker());
    this.closeControl.addEventListener("click", () => this.hidePicker());
    this.picker.addEventListener("keydown", (event) => this.onPickerKeydown(event));
    this.onOutsidePointer = (event) => {
      if (this.open && !event.composedPath().includes(this)) this.hidePicker();
    };
  }

  connectedCallback() {
    document.addEventListener("pointerdown", this.onOutsidePointer);
    document.addEventListener("mousedown", this.onOutsidePointer);
    this.sync();
  }

  disconnectedCallback() {
    document.removeEventListener("pointerdown", this.onOutsidePointer);
    document.removeEventListener("mousedown", this.onOutsidePointer);
  }

  attributeChangedCallback() {
    if (this.isConnected) this.sync();
  }

  get prompt() { return this.getAttribute("prompt") ?? ""; }

  sync() {
    const label = this.hasAttribute("label") ? this.getAttribute("label") : DEFAULT_LABEL;
    this.button.textContent = label;
    this.button.disabled = this.prompt.trim() === "";
    this.button.setAttribute("aria-expanded", String(this.open));
    this.titleElement.textContent = "Choose your agent";
    if (this.button.disabled && this.open) this.hidePicker();
    else if (this.open) this.buildAgents();
  }

  showPicker() {
    if (this.button.disabled || this.open) return;
    this.open = true;
    this.buildAgents();
    this.picker.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.list.querySelector("button")?.focus();
  }

  hidePicker({ restoreFocus = true } = {}) {
    if (!this.open) return;
    this.open = false;
    this.picker.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    if (restoreFocus) this.button.focus();
  }

  buildAgents() {
    this.list.replaceChildren();
    for (const agent of agents) {
      let link;
      let reason = "";
      try {
        link = linkFor(agent.id, this.prompt);
      } catch (error) {
        if (error?.code !== "TOO_LONG") throw error;
        reason = "Prompt is too long for this link";
      }

      const row = document.createElement("button");
      row.type = "button";
      row.className = "agent";
      row.part = "agent";
      row.dataset.testid = `agent-${agent.id}`;
      row.dataset.agent = agent.id;
      if (reason) {
        const reasonId = `connect-agent-reason-${this.instance}-${agent.id}`;
        row.setAttribute("aria-disabled", "true");
        row.setAttribute("aria-describedby", reasonId);
        row.innerHTML = `<span class="mark" aria-hidden="true">${initials(agent.name)}</span><span class="name">${escapeHtml(agent.name)}</span><span class="action">Unavailable</span><span class="reason" id="${reasonId}">${reason}</span>`;
      } else {
        const action = agent.kind === "command" ? "Copy command" : agent.kind === "deeplink" ? "Open app" : "Open";
        row.innerHTML = `<span class="mark" aria-hidden="true">${initials(agent.name)}</span><span class="name">${escapeHtml(agent.name)}</span><span class="action">${action}</span>`;
      }
      row.addEventListener("click", () => this.choose(agent, link));
      this.list.append(row);
    }
  }

  async choose(agent, link) {
    if (!link) return;
    this.hidePicker();
    if (link.kind === "command") {
      await navigator.clipboard.writeText(link.value);
      this.notice.textContent = `${agent.name} command copied — paste it in your terminal.`;
      this.notice.hidden = false;
      return;
    }
    window.open(link.value, "_blank");
  }

  onPickerKeydown(event) {
    const rows = [...this.list.querySelectorAll("button")];
    const at = rows.indexOf(this.root.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      this.hidePicker();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      rows[(at + direction + rows.length) % rows.length]?.focus();
    } else if ((event.key === "Enter" || event.key === " ") && at >= 0) {
      event.preventDefault();
      rows[at].click();
    }
  }
}

function initials(name) {
  return name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

if (!customElements.get("connect-agent")) customElements.define("connect-agent", ConnectAgent);
