import { afterEach, expect, spyOn, test } from "bun:test";
import {
  createDomainScope,
  type DocumentAttributionRangesInput,
  type DocumentAttributionRangesPage,
  type Tearleads,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as Runtime from "../../providers/sdk/TearleadsProvider";
import { useAttributionRangesForDocument } from "./useDocumentAttributionRanges";

const restorers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const restore of restorers.splice(0)) restore();
});

function page(
  documentId: string,
  updateId: string,
  more = false,
  revision = 3,
): DocumentAttributionRangesPage {
  return {
    attributionRevision: revision,
    documentId,
    hasMore: more,
    items: [
      {
        authorityKind: "direct",
        createdAt: "2030-01-01T10:00:00.000Z",
        endCounter: 5,
        peerId: "7",
        signedAt: "2030-01-01T09:59:59.000Z",
        startCounter: 0,
        updateId,
        writerKeyFingerprint: "fingerprint-1",
        writerUserId: "writer-1",
      },
    ],
    nextCursor: more ? "next" : null,
  };
}

function setup() {
  const runtime = {
    auth: {
      authToken: "test-session",
      isAuthenticated: true,
      organizationId: "org-1",
      userId: "reader-1",
    },
    crypto: { signingFingerprint: "reader-fp-1" },
    state: { online: true, domainScope: createDomainScope() },
  };
  const requests: Array<{
    input: DocumentAttributionRangesInput;
    reject: (reason: Error) => void;
    resolve: (value: DocumentAttributionRangesPage) => void;
  }> = [];
  const sdkSpy = spyOn(Runtime, "useTearleads").mockReturnValue({
    containerContents: {
      loadDocumentAttributionRanges(input: DocumentAttributionRangesInput) {
        const pending = Promise.withResolvers<DocumentAttributionRangesPage>();
        requests.push({ input, ...pending });
        return pending.promise;
      },
    },
  } as unknown as Tearleads);
  const runtimeSpy = spyOn(Runtime, "useTearleadsRuntime").mockImplementation(
    () => runtime as unknown as Runtime.RuntimeSnapshot,
  );
  restorers.push(
    () => sdkSpy.mockRestore(),
    () => runtimeSpy.mockRestore(),
  );
  const input = {
    documentId: "doc-1" as string | null,
    enabled: true,
    syncing: false,
  };
  /** Each render's update ids, or null while the first read is pending. */
  const renders: Array<string[] | null> = [];
  const view = renderHook(
    (props) => {
      const ranges = useAttributionRangesForDocument(props);
      renders.push(ranges?.map((range) => range.updateId) ?? null);
      return ranges;
    },
    { initialProps: input },
  );
  async function settle(
    index: number,
    outcome: DocumentAttributionRangesPage | Error,
  ) {
    const request = requests[index];
    if (!request) throw new Error(`Missing request ${index}`);
    await act(async () =>
      outcome instanceof Error
        ? request.reject(outcome)
        : request.resolve(outcome),
    );
  }
  /** One sync cycle completes, which asks for the ranges again. */
  function completeSync() {
    view.rerender({ ...input, syncing: true });
    view.rerender({ ...input, syncing: false });
  }
  return {
    completeSync,
    input,
    renders,
    requests,
    runtime,
    settle,
    updateIds: () =>
      view.result.current?.map((range) => range.updateId) ?? null,
    view,
  };
}

test("a document's ranges are read across its pages", async () => {
  const fixture = setup();
  // Pending, not empty: no ranges yet is not "no uploads".
  expect(fixture.updateIds()).toBeNull();

  await fixture.settle(0, page("doc-1", "update-1", true));
  // Not shown until every page is in: half the list would date a change
  // from whichever uploads had been read.
  expect(fixture.updateIds()).toBeNull();
  await fixture.settle(1, page("doc-1", "update-2"));

  expect(fixture.updateIds()).toEqual(["update-1", "update-2"]);
  expect(fixture.requests.map(({ input }) => input.cursor)).toEqual([
    null,
    "next",
  ]);
});

test("a refresh after a sync keeps the ranges it replaces until it is ready", async () => {
  const fixture = setup();
  await fixture.settle(0, page("doc-1", "update-1"));
  fixture.renders.length = 0;

  fixture.completeSync();

  // The read is asked again, and nothing the ranges resolve goes blank.
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.renders.length).toBeGreaterThan(0);
  expect(fixture.renders.every((ids) => ids?.join() === "update-1")).toBe(true);
  // An upload landed: the revision moved, and the new ranges replace them.
  await fixture.settle(1, page("doc-1", "update-2", false, 4));
  expect(fixture.updateIds()).toEqual(["update-2"]);
});

test("a refresh of a document nothing was uploaded to costs one request", async () => {
  const fixture = setup();
  await fixture.settle(0, page("doc-1", "update-1", true));
  await fixture.settle(1, page("doc-1", "update-2"));
  const held = fixture.view.result.current;

  fixture.completeSync();
  // A one-range probe shows the same revision and first update.
  expect(fixture.requests[2]?.input.limit).toBe(1);
  await fixture.settle(2, page("doc-1", "update-1", true));

  expect(fixture.requests).toHaveLength(3);
  expect(fixture.view.result.current).toBe(held);
});

test("a refresh that fails keeps the ranges already read", async () => {
  const fixture = setup();
  await fixture.settle(0, page("doc-1", "update-1"));

  fixture.completeSync();
  await fixture.settle(1, new Error("stale attribution revision"));

  // What was read still holds: an operation's first upload does not change.
  expect(fixture.updateIds()).toEqual(["update-1"]);
});

test("another document never sees the ranges of the one before", async () => {
  const fixture = setup();
  await fixture.settle(0, page("doc-1", "update-1"));
  fixture.renders.length = 0;

  fixture.view.rerender({ ...fixture.input, documentId: "doc-2" });

  // Not even in the first render of the new document, whose first read is
  // pending.
  expect(fixture.renders.length).toBeGreaterThan(0);
  expect(fixture.renders.every((ids) => ids === null)).toBe(true);
  await fixture.settle(1, page("doc-2", "update-9"));
  expect(fixture.updateIds()).toEqual(["update-9"]);
});

test("another session never sees the ranges of the one before", async () => {
  const fixture = setup();
  await fixture.settle(0, page("doc-1", "update-1"));
  fixture.renders.length = 0;

  fixture.runtime.auth = { ...fixture.runtime.auth, userId: "reader-2" };
  fixture.view.rerender({ ...fixture.input });

  expect(fixture.renders.length).toBeGreaterThan(0);
  expect(fixture.renders.every((ids) => ids === null)).toBe(true);
  expect(fixture.requests).toHaveLength(2);
  // Nor does its read start from what the other session held.
  await fixture.settle(1, page("doc-1", "update-1"));
  expect(fixture.updateIds()).toEqual(["update-1"]);
});

test("a superseded read cannot land, and stops asking for pages", async () => {
  const fixture = setup();

  // The document changes while the first document's first page is in flight.
  fixture.view.rerender({ ...fixture.input, documentId: "doc-2" });
  await fixture.settle(0, page("doc-1", "update-1", true));

  // The new document's own first read is still pending.
  expect(fixture.updateIds()).toBeNull();
  // One request for the old document, one for the new: no second page.
  expect(fixture.requests.map(({ input }) => input.documentId)).toEqual([
    "doc-1",
    "doc-2",
  ]);
});

test("a first read that fails, or has too many pages, yields no ranges", async () => {
  const failed = setup();
  await failed.settle(0, new Error("offline"));
  expect(failed.updateIds()).toEqual([]);
  cleanup();

  const endless = setup();
  for (let index = 0; index < 40; index += 1) {
    await endless.settle(index, page("doc-1", `update-${index}`, true));
  }
  expect(endless.requests).toHaveLength(40);
  expect(endless.updateIds()).toEqual([]);

  // After the next sync, even one that uploaded something, nothing is asked:
  // uploads only add ranges, so there are still too many.
  endless.completeSync();
  endless.completeSync();
  expect(endless.requests).toHaveLength(40);
  expect(endless.updateIds()).toEqual([]);
});

test("nothing is read, or shown, offline or for a document that is not synced", async () => {
  const offline = setup();
  await offline.settle(0, page("doc-1", "update-1"));
  expect(offline.updateIds()).toEqual(["update-1"]);

  offline.runtime.state = { ...offline.runtime.state, online: false };
  offline.view.rerender({ ...offline.input });
  // Attribution is the server's record: offline there is none to show.
  expect(offline.updateIds()).toEqual([]);
  expect(offline.requests).toHaveLength(1);
  cleanup();

  const local = setup();
  await local.settle(0, page("doc-1", "update-1"));
  local.view.rerender({ ...local.input, documentId: null });
  expect(local.updateIds()).toEqual([]);
  expect(local.requests).toHaveLength(1);
});

test("once a first read fails, a refresh is not pending again", async () => {
  const fixture = setup();
  expect(fixture.updateIds()).toBeNull();
  await fixture.settle(0, new Error("offline"));
  expect(fixture.updateIds()).toEqual([]);
  fixture.renders.length = 0;

  // A reader that waited for the first read does not wait again on each
  // sync: the scope has settled, with nothing to show.
  fixture.completeSync();
  expect(fixture.requests).toHaveLength(2);
  expect(fixture.renders.every((ids) => ids?.length === 0)).toBe(true);
  await fixture.settle(1, page("doc-1", "update-1"));
  expect(fixture.updateIds()).toEqual(["update-1"]);
});
