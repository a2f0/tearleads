import { afterEach, expect, test } from "bun:test";
import { readCheckoutAppearance } from "./checkoutAppearance";

const hosts: HTMLElement[] = [];

function mountHost(css?: string): HTMLElement {
  if (css) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    hosts.push(style);
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  return host;
}

afterEach(() => {
  for (const node of hosts.splice(0)) {
    node.remove();
  }
});

test("resolves theme tokens to concrete CSS the iframe can use", () => {
  const host = mountHost(`
    :root {
      --color-light: rgb(10, 20, 30);
      --color-dark: rgb(200, 210, 220);
      --symcrypt-font-family: monospace;
    }
  `);

  const appearance = readCheckoutAppearance(host);

  // Resolved to used values — never a var() reference, which a cross-origin
  // iframe could not dereference.
  expect(appearance.colorBackground).not.toContain("var(");
  expect(appearance.colorText).not.toContain("var(");
  expect(appearance.fontFamily).not.toContain("var(");
  expect(appearance.colorBackground).toBe("rgb(10, 20, 30)");
  expect(appearance.colorText).toBe("rgb(200, 210, 220)");
  // The app is square-cornered.
  expect(appearance.borderRadius).toBe("0");
});

test("leaves no probe element behind in the host", () => {
  const host = mountHost();
  readCheckoutAppearance(host);
  expect(host.childElementCount).toBe(0);
});

test("falls back to neutral defaults without a host or a view", () => {
  const appearance = readCheckoutAppearance(null);
  expect(appearance.fontFamily).toBe("monospace");
  expect(appearance.fontSizeBase).toBe("16px");
  // A detached host has no defaultView-backed layout to read from.
  const detached = document.createElement("div");
  expect(readCheckoutAppearance(detached).colorText).toBeTruthy();
});
