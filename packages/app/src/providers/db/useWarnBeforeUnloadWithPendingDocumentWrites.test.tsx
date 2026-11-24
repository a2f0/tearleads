import { afterEach, expect, test } from "bun:test";
import { createDomainScope, type DomainScope } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
import {
  hasPendingPageDocumentWrites,
  reloadDiscardingPageDocumentWrites,
} from "./pageDocumentWrites";
import { useWarnBeforeUnloadWithPendingDocumentWrites } from "./useWarnBeforeUnloadWithPendingDocumentWrites";

afterEach(cleanup);

function renderGuard(hasPendingWrites: (scope: DomainScope) => boolean) {
  const sdk = { domainScope: createDomainScope() };
  function Harness() {
    useWarnBeforeUnloadWithPendingDocumentWrites(sdk, hasPendingWrites);
    return null;
  }
  return { domainScope: sdk.domainScope, ...render(<Harness />) };
}

function dispatchBeforeUnload(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

test("prevents unload while local document writes are pending", () => {
  const checkedScopes: DomainScope[] = [];
  const { domainScope } = renderGuard((scope) => {
    checkedScopes.push(scope);
    return true;
  });

  const event = dispatchBeforeUnload();

  expect(event.defaultPrevented).toBe(true);
  expect(checkedScopes).toEqual([domainScope]);
});

test("does not prevent unload when no local document writes are pending", () => {
  renderGuard(() => false);

  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
});

test("removes the listener on unmount", () => {
  let checks = 0;
  const { unmount } = renderGuard(() => {
    checks += 1;
    return true;
  });
  unmount();

  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  expect(checks).toBe(0);
});

// Native shells ignore the unload prompt, so a reload the app starts asks
// every mounted runtime itself, through the page's registry, while it is
// mounted.
test("lets a page-wide reload ask for pending writes while mounted", () => {
  let pending = true;
  const { domainScope, unmount } = renderGuard((scope) => {
    expect(scope).toBe(domainScope);
    return pending;
  });

  expect(hasPendingPageDocumentWrites()).toBe(true);
  pending = false;
  expect(hasPendingPageDocumentWrites()).toBe(false);
  pending = true;
  unmount();
  expect(hasPendingPageDocumentWrites()).toBe(false);
});

// Once the app asked and its user chose to lose the edits, that reload's
// unload prompt asks nothing more. Chromium and Firefox dispatch
// `beforeunload` inside `location.reload()`, as `reload` does here; a later
// navigation asks again, even after a reload that threw.
test("a reload whose edits the user discarded does not ask again", () => {
  renderGuard(() => true);
  const inside: boolean[] = [];

  reloadDiscardingPageDocumentWrites(() => {
    inside.push(dispatchBeforeUnload().defaultPrevented);
  });
  expect(inside).toEqual([false]);
  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

  expect(() =>
    reloadDiscardingPageDocumentWrites(() => {
      throw new Error("reload failed");
    }),
  ).toThrow("reload failed");
  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
});
