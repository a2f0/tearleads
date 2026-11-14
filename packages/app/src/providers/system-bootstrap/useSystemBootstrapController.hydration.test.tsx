import { afterEach, expect, test } from "bun:test";
import { createDomainScope, type Tearleads } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { SystemBootstrapRunInput } from "./systemBootstrapRun";
import { useSystemBootstrapController } from "./useSystemBootstrapController";

afterEach(() => cleanup());
type Listener = Parameters<Tearleads["documents"]["subscribe"]>[0];
type Document = Parameters<Listener>[0];

// Isolate controller scheduling; the dual-pane regression proves real hydration.
function controllerFixture(options: { readonly strict?: boolean } = {}) {
  const subscriptions: Array<{ readonly listener: Listener; active: boolean }> =
    [];
  const listeners = new Set<Listener>();
  const runs: Array<ReturnType<typeof Promise.withResolvers<boolean>>> = [];
  let closing = false;
  const tearleads = {
    documents: {
      subscribe: (listener: Listener) => {
        listeners.add(listener);
        const subscription = { listener, active: true };
        subscriptions.push(subscription);
        return () => {
          subscription.active = false;
          listeners.delete(listener);
        };
      },
    },
  } as unknown as Tearleads;
  const bootstrapInput = {
    appData: {
      auth: { userId: "user", organizationId: "org", isAuthenticated: true },
      crypto: { signingFingerprint: "fingerprint" },
      infra: { dbId: "db" },
      state: { domainScope: createDomainScope(), containerId: "root" },
    },
    bootstrapContacts: true,
    containerContentsStore: {},
    systemContainers: [],
    targetKey: "stable-target",
    tearleads,
  } as unknown as SystemBootstrapRunInput;
  // Variable assignment keeps this test valid before the optional wake source
  // is implemented; the existing controller ignores contactsContainerId.
  const input = {
    bootstrapInput,
    contactsContainerId: "contacts",
    enabled: true,
    logError: () => undefined,
    runBootstrap: () => {
      const run = Promise.withResolvers<boolean>();
      runs.push(run);
      if (closing) run.resolve(true);
      return run.promise;
    },
  };
  const view = renderHook(
    () => useSystemBootstrapController(input),
    options.strict ? { wrapper: StrictMode } : {},
  );
  return {
    ...view,
    runs,
    subscriptions,
    emit: (patch: Partial<Document> = {}, savedListener?: Listener) => {
      const document: Document = {
        id: "remote-self",
        documentId: "remote-self",
        containerId: "contacts",
        documentKind: "contact",
        title: "Me",
        updatedAt: "2026-11-01T00:00:00.000Z",
        ...patch,
      };
      for (const listener of savedListener ? [savedListener] : listeners) {
        listener(document, { placementChanged: false });
      }
    },
    async close() {
      closing = true;
      view.unmount();
      await act(async () => {
        for (const run of runs) run.resolve(true);
        await Promise.all(runs.map((run) => run.promise));
      });
    },
  };
}

test("Contacts persistence wakes waiting bootstrap without replacing its input", async () => {
  const f = controllerFixture();
  try {
    await waitFor(() => expect(f.runs).toHaveLength(1));
    await act(async () => f.runs[0]?.resolve(false));
    expect(f.result.current.status).toBe("waiting");
    act(() => {
      f.emit({ documentKind: "note" });
      f.emit({ containerId: "other-contacts" });
    });
    expect(f.runs).toHaveLength(1);
    act(() => f.emit());
    await waitFor(() => expect(f.runs).toHaveLength(2));
    await act(async () => f.runs[1]?.resolve(true));
    expect(f.result.current.status).toBe("ready");
  } finally {
    await f.close();
  }
});

test("Contacts persistence during a run coalesces into one incomplete retry", async () => {
  const f = controllerFixture();
  try {
    await waitFor(() => expect(f.runs).toHaveLength(1));
    act(() => {
      f.emit();
      f.emit();
      f.emit();
    });
    expect(f.runs).toHaveLength(1);
    await act(async () => f.runs[0]?.resolve(false));
    await waitFor(() => expect(f.runs).toHaveLength(2));
    await act(async () => f.runs[1]?.resolve(false));
    expect(f.result.current.status).toBe("waiting");
    expect(f.runs).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("successful bootstrap discards its own persistence notifications", async () => {
  const f = controllerFixture();
  try {
    await waitFor(() => expect(f.runs).toHaveLength(1));
    act(() => f.emit());
    await act(async () => f.runs[0]?.resolve(true));
    expect(f.result.current.status).toBe("ready");
    expect(f.runs).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("an unsubscribed Strict Mode listener cannot wake its still-current owner", async () => {
  const f = controllerFixture({ strict: true });
  try {
    await waitFor(() => expect(f.runs).toHaveLength(1));
    expect(f.subscriptions).toHaveLength(2);
    const first = f.subscriptions[0];
    if (!first) throw new Error("Missing Strict Mode replay subscription");
    expect(first.active).toBe(false);
    expect(f.subscriptions[1]?.active).toBe(true);
    await act(async () => f.runs[0]?.resolve(false));
    expect(f.result.current.status).toBe("waiting");
    await act(async () => f.emit({}, first.listener));
    expect(f.runs).toHaveLength(1);
    expect(f.result.current.status).toBe("waiting");
    await act(async () => f.emit());
    expect(f.runs).toHaveLength(2);
    await act(async () => f.runs[1]?.resolve(true));
    expect(f.result.current.status).toBe("ready");
  } finally {
    await f.close();
  }
});
