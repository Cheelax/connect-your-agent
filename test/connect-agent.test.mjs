import assert from "node:assert/strict";
import test from "node:test";

test("the web component registers and observes its two public attributes", async () => {
  const previousElement = globalThis.HTMLElement;
  const previousRegistry = globalThis.customElements;
  let registered;
  globalThis.HTMLElement = class {};
  globalThis.customElements = {
    get: () => undefined,
    define(name, constructor) { registered = { name, constructor }; },
  };
  try {
    const module = await import(`../src/connect-agent.mjs?test=${Date.now()}`);
    assert.equal(registered.name, "connect-agent");
    assert.equal(registered.constructor, module.ConnectAgent);
    assert.deepEqual(module.ConnectAgent.observedAttributes, ["prompt", "label"]);
  } finally {
    globalThis.HTMLElement = previousElement;
    globalThis.customElements = previousRegistry;
  }
});
