import { afterEach, expect, test } from "bun:test";
import { createDomainScope, type DomainScope } from "@tearleads/client-sdk";
import { cleanup, render } from "@testing-library/react";
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
