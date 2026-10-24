import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ScreenshotManifest } from "./screenshotsManifest";

// A screen route's URL, which the gallery rewrites as it steps.
GlobalRegistrator.register({
  url: "https://tearleads.com/screenshots/mobile/explorer/",
});
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { ScreenshotsBrowser } = await import("./ScreenshotsBrowser");

const manifest: ScreenshotManifest = {
  projects: ["mobile"],
  themes: ["light"],
  screens: ["explorer", "notes"],
  entries: ["explorer", "notes"].map((name) => ({
    project: "mobile",
    theme: "light",
    name,
    src: `/screenshot-gallery/img/mobile/light/${name}.png`,
    width: 1170,
    height: 1992,
  })),
};
const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  globalThis.fetch = realFetch;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test("stepping to another screen gives the page that screen's heading and title", async () => {
  globalThis.fetch = Object.assign(
    async () => new Response(JSON.stringify(manifest)),
    { preconnect: realFetch.preconnect },
  );
  document.title = "Explorer, phone screenshot | Tearleads";
  // The route's server-rendered PageHeader h1.
  const heading = document.createElement("h1");
  heading.id = "page-title";
  heading.textContent = "Explorer, phone screenshot";
  document.body.append(heading);

  // Inside act, React flushes the manifest load when the callback settles
  // instead of through its scheduler, which another test file's happy-dom
  // window may have captured and closed.
  let view: ReturnType<typeof render> | undefined;
  await act(async () => {
    view = render(
      <ScreenshotsBrowser initialPlatform="mobile" initialScreen="explorer" />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const next = view?.getByRole("button", { name: "Next screen" });
  if (!next) throw new Error("The gallery did not render");
  // Opening a screen's URL leaves its server-rendered heading alone.
  expect(window.location.pathname).toBe("/screenshots/mobile/explorer/");
  expect(heading.textContent).toBe("Explorer, phone screenshot");

  fireEvent.click(next);
  expect(window.location.pathname).toBe("/screenshots/mobile/notes/");
  expect(heading.textContent).toBe("Notes, phone screenshot");
  expect(document.title).toBe("Notes, phone screenshot | Tearleads");
});
