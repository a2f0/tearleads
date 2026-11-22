import { expect, test } from "bun:test";
import {
  BYTES,
  countOpens,
  hydrateHeldCopy,
  openHeldCopy,
  SLOT_ID,
  STORAGE_KEY,
  serveHeldBinding,
  slotView,
  until,
} from "../../../../../test/helpers/stores/heldCopyChecks";
import type { DocumentsPersistence } from "../../../../data/persistence/documents/types";
import { resetDocumentStore } from "../state";
import { unavailableHeldCopySlotIds } from "./heldCopyChecks";

// Missing bytes retry on every hydration pass, like a slot with no bytes: an
// unavailable copy must not wait for a remote signal that may never come.

test("an unavailable copy whose repair commit was refused is fetched again by the next pass", async () => {
  const files = new Map();
  const held = await openHeldCopy("held-copy-refused-repair", files);
  const persistence = held.state.persistence;
  let refusals = 1;
  // A concurrent write moved the durable row or frontier under the commit.
  const refusingPersistence: DocumentsPersistence = {
    ...persistence,
    saveHydratedAttachment: (execSql, input) => {
      if (refusals === 0)
        return persistence.saveHydratedAttachment(execSql, input);
      refusals -= 1;
      return Promise.resolve(false);
    },
  };
  Object.assign(held.state, { persistence: refusingPersistence });
  try {
    await held.check();
    const requests = serveHeldBinding(held, {
      bytes: BYTES,
      contentSha256: held.attachment.contentSha256,
      intentMismatch: false,
    });
    await hydrateHeldCopy(held);
    expect(requests).toHaveLength(1);
    expect(slotView(held.state).status).toBe("unavailable");
    // No remote signal arrives in between.
    const signal = held.state.remoteUpdateSignalSeq;
    await hydrateHeldCopy(held);
    expect(held.state.remoteUpdateSignalSeq).toBe(signal);
    expect(requests).toHaveLength(2);
    expect(slotView(held.state)).toEqual({
      status: undefined,
      storageKey: STORAGE_KEY,
    });
    // Held again, the copy waits for a remote signal like any held copy.
    await hydrateHeldCopy(held);
    expect(requests).toHaveLength(2);
  } finally {
    held.close();
  }
});

test("a finding that settles while the store reloads is fetched again without a remote signal", async () => {
  const held = await openHeldCopy("held-copy-reload-finding", new Map());
  const blobStore = held.runtime.infra.blobStore;
  const firstOpen = Promise.withResolvers<null>();
  const opens = countOpens(held.runtime, (storageKey) =>
    opens.count === 1
      ? firstOpen.promise
      : blobStore.openByteSource(storageKey),
  );
  // A server-events connect in flight defers the reloaded store's startup
  // probe, so nothing raises a remote signal after the reload.
  Object.assign(held.runtime.state, { serverEventsPendingConnectAttempt: 1 });
  try {
    const checking = held.check();
    await until(() => opens.count === 1);
    resetDocumentStore(held.state);
    // The finding settles before the store is ready, so it is not published.
    firstOpen.resolve(null);
    await checking;
    expect(held.state.snapshot.ready).toBe(false);
    expect(await held.ensureReady()).toBe(true);
    expect(unavailableHeldCopySlotIds(held.state)).toEqual(new Set([SLOT_ID]));
    expect(slotView(held.state).status).toBe("unavailable");
    expect(held.state.remoteUpdateSignalSeq).toBe(0);
    const requests = serveHeldBinding(held, {
      bytes: BYTES,
      contentSha256: held.attachment.contentSha256,
      intentMismatch: false,
    });
    // A local edit's sync pass hydrates before any remote signal arrives.
    await hydrateHeldCopy(held);
    expect(requests).toHaveLength(1);
    expect(slotView(held.state)).toEqual({
      status: undefined,
      storageKey: STORAGE_KEY,
    });
  } finally {
    held.close();
  }
});
