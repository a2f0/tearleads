import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  followColorSchemeMedia,
  mediaForColorScheme,
} from "./colorSchemeMedia";

// The DOM is registered for this file only; other website tests use Bun's own
// fetch and Response, so the globals are restored after (as in SiteNav.test).
GlobalRegistrator.register();

let stopFollowing: (() => void) | undefined;

afterEach(() => {
  stopFollowing?.();
  stopFollowing = undefined;
  document.documentElement.removeAttribute("data-theme-scheme");
  document.head.replaceChildren();
  document.body.replaceChildren();
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const DARK = "(prefers-color-scheme: dark)";
const PHONE_DARK = "(max-width: 699px) and (prefers-color-scheme: dark)";

function source(media: string): HTMLSourceElement {
  const element = document.createElement("source");
  element.setAttribute("media", media);
  return element;
}

function themeColor(media: string): HTMLMetaElement {
  const element = document.createElement("meta");
  element.setAttribute("name", "theme-color");
  element.setAttribute("media", media);
  return element;
}

/**
 * Resolves when the next mutation batch is delivered. Observers are notified
 * in creation order, so one created after followColorSchemeMedia's runs after
 * it has rewritten the batch.
 */
function nextMutationBatch(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const observer = new MutationObserver(() => {
    observer.disconnect();
    resolve();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });
  return promise;
}

test("the stamped scheme decides screenshot and theme-color queries", () => {
  const dark = source(DARK);
  const phoneDark = source(PHONE_DARK);
  const wide = source("(min-width: 700px)");
  const lightColor = themeColor("(prefers-color-scheme: light)");
  const darkColor = themeColor(DARK);
  document.body.append(dark, phoneDark, wide);
  document.head.append(lightColor, darkColor);
  document.documentElement.setAttribute("data-theme-scheme", "dark");

  stopFollowing = followColorSchemeMedia(document);

  expect(dark.getAttribute("media")).toBe("all");
  expect(phoneDark.getAttribute("media")).toBe("(max-width: 699px)");
  expect(wide.getAttribute("media")).toBe("(min-width: 700px)");
  expect(wide.hasAttribute("data-color-scheme-media")).toBe(false);
  expect(lightColor.getAttribute("media")).toBe("not all");
  expect(darkColor.getAttribute("media")).toBe("all");
});

test("each later stamp redecides from the original query", async () => {
  const phoneDark = source(PHONE_DARK);
  document.body.append(phoneDark);
  stopFollowing = followColorSchemeMedia(document);
  expect(phoneDark.getAttribute("media")).toBe(PHONE_DARK);

  let delivered = nextMutationBatch();
  document.documentElement.setAttribute("data-theme-scheme", "light");
  await delivered;
  expect(phoneDark.getAttribute("media")).toBe("not all");

  delivered = nextMutationBatch();
  document.documentElement.setAttribute("data-theme-scheme", "dark");
  await delivered;
  expect(phoneDark.getAttribute("media")).toBe("(max-width: 699px)");
  expect(phoneDark.getAttribute("data-color-scheme-media")).toBe(PHONE_DARK);
});

test("sources added after it starts follow the stamped scheme", async () => {
  document.documentElement.setAttribute("data-theme-scheme", "light");
  stopFollowing = followColorSchemeMedia(document);

  const picture = document.createElement("picture");
  const dark = source(DARK);
  picture.append(dark, document.createElement("img"));
  const delivered = nextMutationBatch();
  document.body.append(picture);
  await delivered;

  expect(dark.getAttribute("media")).toBe("not all");
});

test("a lone scheme feature becomes all or not all", () => {
  expect(mediaForColorScheme("(prefers-color-scheme: dark)", "dark")).toBe(
    "all",
  );
  expect(mediaForColorScheme("(prefers-color-scheme: dark)", "light")).toBe(
    "not all",
  );
  expect(mediaForColorScheme("(prefers-color-scheme: light)", "light")).toBe(
    "all",
  );
});

test("other conditions in the query survive the scheme decision", () => {
  const phoneDark = "(max-width: 699px) and (prefers-color-scheme: dark)";
  expect(mediaForColorScheme(phoneDark, "dark")).toBe("(max-width: 699px)");
  expect(mediaForColorScheme(phoneDark, "light")).toBe("not all");
});

test("each query in a list is decided on its own", () => {
  expect(
    mediaForColorScheme(
      "(prefers-color-scheme: dark), (min-width: 700px)",
      "light",
    ),
  ).toBe("(min-width: 700px)");
  expect(
    mediaForColorScheme("print, (prefers-color-scheme: dark)", "dark"),
  ).toBe("print, all");
});
