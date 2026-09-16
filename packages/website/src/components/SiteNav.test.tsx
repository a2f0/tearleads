import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// The DOM is registered for this file only, and before React DOM loads, since
// react-dom detects the DOM when its module is first evaluated. Other website
// tests use Bun's own fetch and Response, so the globals are restored after.
GlobalRegistrator.register();
const rtl = await import("@testing-library/react");
const server = await import("react-dom/server");
const nav = await import("./SiteNav");

afterEach(() => {
  rtl.cleanup();
  document.body.replaceChildren();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function staticNav(pathname: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = server.renderToStaticMarkup(
    <nav.SiteNav pathname={pathname} />,
  );
  return host;
}

function currentStates(root: ParentNode): Record<string, string | null> {
  return Object.fromEntries(
    Array.from(root.querySelectorAll("a.site-nav-link"), (link) => [
      link.getAttribute("href") ?? "",
      link.getAttribute("aria-current"),
    ]),
  );
}

// The static HTML is what visitors without JS, or with a failed island script,
// get: one Primary landmark and a menu toggle that links to the footer nav.
test("static HTML has one Primary nav and a toggle that links to the footer", () => {
  const html = staticNav("/pricing");
  expect(html.querySelectorAll("nav")).toHaveLength(1);
  expect(html.querySelector("nav")?.getAttribute("aria-label")).toBe("Primary");
  const toggle = html.querySelector(".site-nav-toggle");
  expect(toggle?.tagName).toBe("A");
  expect(toggle?.getAttribute("href")).toBe(`#${nav.FOOTER_NAV_ID}`);
  expect(toggle?.textContent).toBe("Menu");
  expect(currentStates(html)).toEqual({
    "/features": null,
    "/security": null,
    "/pricing": "page",
    "/#download": null,
  });
});

test("pages inside a section mark that section as current", () => {
  expect(currentStates(staticNav("/manage-subscription"))).toMatchObject({
    "/pricing": "true",
  });
  expect(currentStates(staticNav("/downloads/linux"))).toMatchObject({
    "/#download": "true",
  });
  expect(currentStates(staticNav("/features"))).toMatchObject({
    "/features": "page",
    "/pricing": null,
  });
});

function renderNav() {
  const outside = document.createElement("button");
  outside.textContent = "Outside";
  document.body.append(outside);
  const view = rtl.render(<nav.SiteNav pathname="/" />);
  const root = view.container.querySelector("nav");
  const toggle = view.container.querySelector("button.site-nav-toggle");
  if (!(root instanceof HTMLElement) || !(toggle instanceof HTMLElement)) {
    throw new Error("the hydrated nav should render a toggle button");
  }
  const open = () => rtl.fireEvent.click(toggle);
  const firstLink = () => {
    const link = root.querySelector("a.site-nav-link");
    if (!(link instanceof HTMLElement)) throw new Error("missing nav link");
    return link;
  };
  return { firstLink, open, outside, root, toggle };
}

test("hydration swaps in a button that opens and closes the menu", () => {
  const { open, root, toggle } = renderNav();
  expect(root.querySelector("a.site-nav-toggle")).toBeNull();
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.getAttribute("aria-label")).toBe("Open menu");
  expect(toggle.getAttribute("aria-controls")).toBe(
    root.querySelector("ul")?.id ?? "",
  );
  expect(root.hasAttribute("data-open")).toBe(false);

  open();
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(toggle.getAttribute("aria-label")).toBe("Close menu");
  expect(root.getAttribute("data-open")).toBe("true");

  rtl.fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

test("Escape closes the menu and returns focus from a link to the toggle", () => {
  const { firstLink, open, toggle } = renderNav();
  open();
  firstLink().focus();
  rtl.fireEvent.keyDown(firstLink(), { key: "Escape" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(toggle);
});

test("only a primary press outside the nav closes the menu", () => {
  const { firstLink, open, outside, toggle } = renderNav();
  open();
  rtl.fireEvent.pointerDown(firstLink(), { button: 0 });
  rtl.fireEvent.pointerDown(outside, { button: 2 });
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  rtl.fireEvent.pointerDown(outside, { button: 0 });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

test("focus leaving the nav closes the menu, and following a link closes it", () => {
  const { firstLink, open, outside, toggle } = renderNav();
  open();
  rtl.fireEvent.focusIn(firstLink());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  rtl.fireEvent.focusIn(outside);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");

  open();
  rtl.fireEvent.click(firstLink());
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
