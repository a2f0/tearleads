import { afterEach, expect, spyOn, test } from "bun:test";
import {
  createDomainScope,
  type DocumentStore,
  type Tearleads,
} from "@tearleads/client-sdk";
import type { DocumentEditAttributionResponse } from "@tearleads/validators/response";
import { act, cleanup, renderHook } from "@testing-library/react";
import { type ComponentType, type PropsWithChildren, StrictMode } from "react";
import * as Runtime from "../../providers/sdk/TearleadsProvider";
import { DocumentContext } from "./DocumentsProvider";
import * as RowWriters from "./useDocumentRowWriters";

type Response = DocumentEditAttributionResponse | null;
const restorers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const restore of restorers.splice(0)) restore();
});

function response(documentId: string, writerUserId: string) {
  return {
    attributionRevision: 1,
    documentId,
    segments: [
      {
        authorityKind: "direct" as const,
        peerId: "7",
        startCounter: 0,
        endCounter: 5,
        writerUserId,
        writerKeyFingerprint: `fp-${writerUserId}`,
      },
    ],
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
    documentId: string;
    resolve: (value: Response) => void;
    reject: (reason: Error) => void;
  }> = [];
  const containerContents = {
    loadDocumentEditAttribution(documentId: string) {
      const pending = Promise.withResolvers<Response>();
      requests.push({ documentId, ...pending });
      return pending.promise;
    },
  };
  const sdkSpy = spyOn(Runtime, "useTearleads").mockReturnValue({
    containerContents,
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
    syncing: false,
    enabled: true,
  };
  const renders: Array<string | null> = [];
  function mount(wrapper?: ComponentType<PropsWithChildren>) {
    return renderHook(
      (props) => {
        const resolve = RowWriters.useRowWritersForDocument(props);
        renders.push(resolve("7"));
        return resolve;
      },
      { initialProps: input, wrapper },
    );
  }
  async function complete(index: number, value: Response) {
    const request = requests[index];
    if (!request) throw new Error(`Missing request ${index}`);
    await act(async () => request.resolve(value));
  }
  function replaceClient() {
    sdkSpy.mockReturnValue({
      containerContents: { ...containerContents },
    } as unknown as Tearleads);
  }
  async function fail(index: number) {
    const request = requests[index];
    if (!request) throw new Error(`Missing request ${index}`);
    await act(async () => request.reject(new Error("unavailable")));
  }
  return {
    complete,
    fail,
    input,
    mount,
    replaceClient,
    requests,
    renders,
    runtime,
  };
}

test("resolves supplied document attribution without a DocumentProvider", async () => {
  expect(typeof RowWriters.useRowWritersForDocument).toBe("function");
  const fixture = setup();
  const view = fixture.mount();
  expect(view.result.current("7")).toBeNull();
  expect(fixture.requests.map(({ documentId }) => documentId)).toEqual([
    "doc-1",
  ]);
  await fixture.complete(0, response("doc-1", "writer-1"));
  expect(view.result.current("7")).toBe("writer-1");
});

test("a document switch clears attribution in the first render", async () => {
  const fixture = setup();
  const view = fixture.mount();
  await fixture.complete(0, response("doc-1", "writer-1"));
  fixture.renders.length = 0;
  view.rerender({ ...fixture.input, documentId: "doc-2" });
  expect(fixture.renders.length).toBeGreaterThan(0);
  expect(fixture.renders.every((writer) => writer === null)).toBe(true);
  expect(fixture.requests.map(({ documentId }) => documentId)).toEqual([
    "doc-1",
    "doc-2",
  ]);
  await fixture.complete(1, response("doc-2", "writer-2"));
  expect(view.result.current("7")).toBe("writer-2");
});

test("refuses a response for a different document", async () => {
  const fixture = setup();
  const view = fixture.mount();
  await fixture.complete(0, response("other-document", "wrong-writer"));
  expect(view.result.current("7")).toBeNull();
});

test("a replacement client never starts an old document request", async () => {
  const fixture = setup();
  const view = fixture.mount();
  fixture.replaceClient();
  view.rerender({ ...fixture.input, documentId: "doc-2" });
  expect(fixture.requests.map(({ documentId }) => documentId)).toEqual([
    "doc-1",
    "doc-2",
  ]);
  await fixture.complete(1, response("doc-2", "writer-2"));
  await fixture.complete(0, response("doc-1", "stale-writer"));
  expect(view.result.current("7")).toBe("writer-2");
});

test("the legacy wrapper reads its document from DocumentContext", async () => {
  const fixture = setup();
  const snapshot = { documentId: "context-document", syncing: false };
  const store = {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
  } as unknown as DocumentStore;
  const view = renderHook(() => RowWriters.useDocumentRowWriters(true), {
    wrapper: ({ children }) => (
      <DocumentContext.Provider value={store}>
        {children}
      </DocumentContext.Provider>
    ),
  });
  expect(fixture.requests.map(({ documentId }) => documentId)).toEqual([
    "context-document",
  ]);
  await fixture.complete(0, response("context-document", "context-writer"));
  expect(view.result.current("7")).toBe("context-writer");
});

test.each(["account", "organization", "signer", "session", "domain"] as const)(
  "a %s switch clears attribution before effects and refetches the same document",
  async (scope) => {
    const fixture = setup();
    const view = fixture.mount();
    await fixture.complete(0, response("doc-1", "writer-1"));
    switch (scope) {
      case "account":
        fixture.runtime.auth.userId = "reader-2";
        break;
      case "organization":
        fixture.runtime.auth.organizationId = "org-2";
        break;
      case "signer":
        fixture.runtime.crypto.signingFingerprint = "reader-fp-2";
        break;
      case "session":
        fixture.runtime.auth.authToken = "test-session-2";
        break;
      case "domain":
        fixture.runtime.state.domainScope = createDomainScope();
        break;
    }
    fixture.renders.length = 0;
    view.rerender({ ...fixture.input });
    expect(fixture.renders.length).toBeGreaterThan(0);
    expect(fixture.renders.every((writer) => writer === null)).toBe(true);
    expect(fixture.requests.map(({ documentId }) => documentId)).toEqual([
      "doc-1",
      "doc-1",
    ]);
    await fixture.complete(1, response("doc-1", "writer-2"));
    expect(view.result.current("7")).toBe("writer-2");
  },
);

test.each(["document", "account", "signer"] as const)(
  "late successes and failures cannot cross an A-B-A %s switch",
  async (scope) => {
    const fixture = setup();
    const view = fixture.mount();
    if (scope === "account") fixture.runtime.auth.userId = "reader-2";
    if (scope === "signer")
      fixture.runtime.crypto.signingFingerprint = "reader-fp-2";
    view.rerender({
      ...fixture.input,
      documentId: scope === "document" ? "doc-2" : "doc-1",
    });
    fixture.runtime.auth.userId = "reader-1";
    fixture.runtime.crypto.signingFingerprint = "reader-fp-1";
    view.rerender({ ...fixture.input });
    expect(fixture.requests).toHaveLength(3);
    await fixture.complete(2, response("doc-1", "current-writer"));
    await fixture.complete(0, response("doc-1", "stale-writer"));
    await fixture.fail(1);
    expect(view.result.current("7")).toBe("current-writer");
  },
);

test.each(["disabled", "local-only", "offline", "unauthenticated"] as const)(
  "%s attribution stays unknown, clears immediately, and ignores late responses",
  async (reason) => {
    const fixture = setup();
    function setAllowed(allowed: boolean) {
      fixture.input.enabled = reason !== "disabled" || allowed;
      fixture.input.documentId =
        reason === "local-only" && !allowed ? null : "doc-1";
      fixture.runtime.state.online = reason !== "offline" || allowed;
      fixture.runtime.auth.isAuthenticated =
        reason !== "unauthenticated" || allowed;
    }
    setAllowed(false);
    const view = fixture.mount();
    expect(fixture.requests).toHaveLength(0);
    expect(view.result.current("7")).toBeNull();
    setAllowed(true);
    view.rerender({ ...fixture.input });
    await fixture.complete(0, response("doc-1", "writer-1"));
    expect(view.result.current("7")).toBe("writer-1");
    setAllowed(false);
    fixture.renders.length = 0;
    view.rerender({ ...fixture.input });
    expect(fixture.renders.every((writer) => writer === null)).toBe(true);
    expect(fixture.requests).toHaveLength(1);
    setAllowed(true);
    view.rerender({ ...fixture.input });
    expect(fixture.requests).toHaveLength(2);
    setAllowed(false);
    view.rerender({ ...fixture.input });
    await fixture.complete(1, response("doc-1", "late-writer"));
    expect(view.result.current("7")).toBeNull();
  },
);

test("refreshes only when a sync completes and ignores the pre-sync response", async () => {
  const fixture = setup();
  const view = fixture.mount();
  view.rerender({ ...fixture.input, syncing: true });
  expect(fixture.requests).toHaveLength(1);
  view.rerender({ ...fixture.input, syncing: false });
  expect(fixture.requests).toHaveLength(2);
  await fixture.complete(1, response("doc-1", "synced-writer"));
  await fixture.complete(0, response("doc-1", "pre-sync-writer"));
  expect(view.result.current("7")).toBe("synced-writer");
  view.rerender({ ...fixture.input });
  expect(fixture.requests).toHaveLength(2);
  view.rerender({ ...fixture.input, syncing: true });
  view.rerender({ ...fixture.input });
  expect(fixture.requests).toHaveLength(3);
  await fixture.complete(2, response("doc-1", "next-sync-writer"));
  expect(view.result.current("7")).toBe("next-sync-writer");
});

test.each(["truncated", "ambiguous", "null", "rejected"] as const)(
  "a %s refresh discards previously resolved attribution",
  async (reason) => {
    const fixture = setup();
    const view = fixture.mount();
    await fixture.complete(0, response("doc-1", "writer-1"));
    view.rerender({ ...fixture.input, syncing: true });
    view.rerender({ ...fixture.input });
    const fresh = response("doc-1", "writer-1");
    if (reason === "rejected") {
      await fixture.fail(1);
    } else {
      if (reason === "ambiguous")
        fresh.segments.push(...response("doc-1", "writer-2").segments);
      await fixture.complete(
        1,
        reason === "null"
          ? null
          : { ...fresh, truncated: reason === "truncated" },
      );
    }
    expect(view.result.current("7")).toBeNull();
  },
);

test("StrictMode and unmount cleanup leave only current attribution visible", async () => {
  const fixture = setup();
  const view = fixture.mount(StrictMode);
  expect(fixture.requests.length).toBeGreaterThan(0);
  const last = fixture.requests.length - 1;
  await fixture.complete(last, response("doc-1", "current-writer"));
  for (let index = 0; index < last; index += 1) await fixture.fail(index);
  expect(view.result.current("7")).toBe("current-writer");
  view.rerender({ ...fixture.input, documentId: "doc-2" });
  view.unmount();
  const renderCount = fixture.renders.length;
  await fixture.complete(
    fixture.requests.length - 1,
    response("doc-2", "unmounted-writer"),
  );
  expect(fixture.renders).toHaveLength(renderCount);
});
