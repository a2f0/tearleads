import { afterEach, expect, mock, test } from "bun:test";
import type {
  DocumentSummary,
  LocalProjectionSnapshot,
  LocalProjectionView,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useExplorerViewProjectionSync } from "./useExplorerViewProjectionSync";

afterEach(() => cleanup());

function createSummary(
  id: string,
  overrides: Partial<DocumentSummary> = {},
): DocumentSummary {
  return {
    containerId: "contacts",
    documentId: `${id}-doc`,
    documentKind: "note",
    id,
    title: id,
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

// A fake projection view whose snapshot can be swapped between "sync ticks". Each
// swap invokes the subscriber exactly once, mirroring how the real view fires on
// every reconciled delta during bootstrap. `setActiveContainer` calls are recorded
// so the active-pointer wiring can be asserted.
function createFakeView(
  initialSummariesByContainerId: ReadonlyMap<
    string,
    ReadonlyArray<DocumentSummary>
  >,
): {
  view: LocalProjectionView;
  emit: (next: ReadonlyMap<string, ReadonlyArray<DocumentSummary>>) => void;
  activeContainerCalls: Array<string | null>;
} {
  let summariesByContainerId = initialSummariesByContainerId;
  const listeners = new Set<() => void>();
  const activeContainerCalls: Array<string | null> = [];

  const snapshot = (): LocalProjectionSnapshot => ({
    containers: [],
    documentSummariesByContainerId: summariesByContainerId,
    linkedContainerIdsByDocumentId: new Map(),
    ready: true,
  });

  const view: LocalProjectionView = {
    getSnapshot: snapshot,
    setActiveContainer: (containerId) => {
      activeContainerCalls.push(containerId);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateRuntime: () => {},
  };

  return {
    activeContainerCalls,
    emit: (next) => {
      summariesByContainerId = next;
      for (const listener of listeners) {
        listener();
      }
    },
    view,
  };
}

function contactsMap(
  summaries: ReadonlyArray<DocumentSummary>,
): ReadonlyMap<string, ReadonlyArray<DocumentSummary>> {
  return new Map([["contacts", summaries]]);
}

function renderSync(
  view: LocalProjectionView,
  activeContainerId: string | null = "contacts",
) {
  const mergeDocumentSummaries = mock(() => {});
  const onDocumentLinksChanged = mock(() => {});
  const primeDiscoveredDocuments = mock(() => {});

  const utils = renderHook(
    (props: { view: LocalProjectionView }) =>
      useExplorerViewProjectionSync({
        activeContainerId,
        mergeDocumentSummaries,
        onDocumentLinksChanged,
        primeDiscoveredDocuments,
        view: props.view,
      }),
    { initialProps: { view } },
  );

  return {
    ...utils,
    mergeDocumentSummaries,
    onDocumentLinksChanged,
    primeDiscoveredDocuments,
  };
}

// The regression this locks: during cold bootstrap the view fires on every
// reconciled delta (sync badges, decrypted titles) while container membership is
// unchanged. The link projection is the DESTRUCTIVE sidebar refresh, so bumping it
// per tick re-blanked the "You" contact + Trash rows ~15x (the reported flicker).
// A long burst of content-only ticks must therefore bump it exactly once (mount).
test("content-only bootstrap churn bumps the link projection only once", () => {
  const { view, emit } = createFakeView(
    contactsMap([createSummary("you", { title: "You" })]),
  );
  const { onDocumentLinksChanged } = renderSync(view);

  // Mount applies the initial projection: one legitimate bump populates the rows.
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(1);

  // 20 sync ticks: same membership ([you]), each with a fresh summary object
  // carrying an updated title/sync timestamp — exactly the deltas bootstrap emits.
  act(() => {
    for (let tick = 0; tick < 20; tick++) {
      emit(
        contactsMap([
          createSummary("you", {
            title: `You (sync ${tick})`,
            updatedAt: `2026-06-01T00:00:${String(tick).padStart(2, "0")}.000Z`,
          }),
        ]),
      );
    }
  });

  // Pre-fix this was 21 (one per tick + mount). The membership gate holds it at 1.
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(1);
});

test("an empty bootstrap apply preserves the initial population bump", () => {
  const { view, emit } = createFakeView(new Map());
  const { onDocumentLinksChanged } = renderSync(view);

  expect(onDocumentLinksChanged).not.toHaveBeenCalled();

  act(() => {
    emit(contactsMap([createSummary("you")]));
  });
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(1);

  act(() => {
    emit(contactsMap([createSummary("you", { title: "You (synced)" })]));
  });
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(1);
});

test("membership changes each bump the link projection exactly once", () => {
  const { view, emit } = createFakeView(contactsMap([createSummary("you")]));
  const { onDocumentLinksChanged } = renderSync(view);
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(1);

  // Discover a teammate contact: membership grew, so one destructive refresh.
  act(() => {
    emit(contactsMap([createSummary("you"), createSummary("teammate")]));
  });
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(2);

  // A content-only tick in between must not bump.
  act(() => {
    emit(
      contactsMap([
        createSummary("you", { title: "You edited" }),
        createSummary("teammate"),
      ]),
    );
  });
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(2);

  // Remove the teammate again: membership shrank, one more refresh.
  act(() => {
    emit(contactsMap([createSummary("you")]));
  });
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(3);
});

// The regression this locks: the SDK view's summaries cache materializes a
// container lazily when it first becomes active. Selecting the "You" contact made
// the Contacts container active, so its key appeared in the projection for the
// first time — but no document changed containers. Bumping the DESTRUCTIVE link
// projection on that additive key blanked every expanded container (Contacts
// collapsed, Trash bounced up/down). An additive container key must NOT bump; a
// real change to an already-present container still must.
test("a container key appearing for the first time does not bump", () => {
  const { view, emit } = createFakeView(contactsMap([createSummary("you")]));
  const { onDocumentLinksChanged } = renderSync(view);
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(1); // mount

  // A second container materializes for the first time (active-container switch) —
  // additive key only, no existing container changed.
  act(() => {
    emit(
      new Map([
        ["contacts", [createSummary("you")]],
        ["trash", [createSummary("old", { containerId: "trash" })]],
      ]),
    );
  });
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(1);

  // A real change to the already-present Contacts container still bumps.
  act(() => {
    emit(
      new Map([
        ["contacts", [createSummary("you"), createSummary("teammate")]],
        ["trash", [createSummary("old", { containerId: "trash" })]],
      ]),
    );
  });
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(2);
});

test("reordering the same members does not bump the link projection", () => {
  const { view, emit } = createFakeView(
    contactsMap([createSummary("you"), createSummary("teammate")]),
  );
  const { onDocumentLinksChanged } = renderSync(view);
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(1);

  act(() => {
    emit(contactsMap([createSummary("teammate"), createSummary("you")]));
  });
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(1);
});

test("a new view rotation re-bumps once and re-points the active container", () => {
  const first = createFakeView(contactsMap([createSummary("you")]));
  const rendered = renderSync(first.view);
  expect(rendered.onDocumentLinksChanged).toHaveBeenCalledTimes(1);
  expect(first.activeContainerCalls).toEqual(["contacts"]);

  // Rotating to a new view (a domain-scope change) must reset the membership
  // tracking so the new scope re-signatures from scratch — even when the new view
  // happens to expose the same membership as the old one.
  const second = createFakeView(contactsMap([createSummary("you")]));
  act(() => {
    rendered.rerender({ view: second.view });
  });
  expect(rendered.onDocumentLinksChanged).toHaveBeenCalledTimes(2);
  expect(second.activeContainerCalls).toEqual(["contacts"]);

  // ...and content-only churn on the rotated view is gated exactly as before.
  act(() => {
    second.emit(contactsMap([createSummary("you", { title: "You (synced)" })]));
  });
  expect(rendered.onDocumentLinksChanged).toHaveBeenCalledTimes(2);
});

test("primes each distinct summary-list instance once per view", () => {
  const listA = [createSummary("you")];
  const { view, emit } = createFakeView(contactsMap(listA));
  const { primeDiscoveredDocuments } = renderSync(view);

  // Mount primes the initial list once.
  expect(primeDiscoveredDocuments).toHaveBeenCalledTimes(1);
  expect(primeDiscoveredDocuments).toHaveBeenLastCalledWith(listA);

  // Re-emitting the SAME list instance must not re-prime (the projection only
  // swaps the array when its contents change).
  act(() => {
    emit(contactsMap(listA));
  });
  expect(primeDiscoveredDocuments).toHaveBeenCalledTimes(1);

  // A fresh list instance (new membership) primes again.
  const listB = [createSummary("you"), createSummary("teammate")];
  act(() => {
    emit(contactsMap(listB));
  });
  expect(primeDiscoveredDocuments).toHaveBeenCalledTimes(2);
  expect(primeDiscoveredDocuments).toHaveBeenLastCalledWith(listB);
});

test("callback rotation does not re-prime an unchanged projection", () => {
  const list = [createSummary("you")];
  const { view } = createFakeView(contactsMap(list));
  const mergeDocumentSummaries = mock(() => {});
  const onDocumentLinksChanged = mock(() => {});
  const firstPrime = mock(() => {});
  const secondPrime = mock(() => {});
  const rendered = renderHook(
    (props: { primeDiscoveredDocuments: typeof firstPrime }) =>
      useExplorerViewProjectionSync({
        activeContainerId: "contacts",
        mergeDocumentSummaries,
        onDocumentLinksChanged,
        primeDiscoveredDocuments: props.primeDiscoveredDocuments,
        view,
      }),
    { initialProps: { primeDiscoveredDocuments: firstPrime } },
  );

  expect(firstPrime).toHaveBeenCalledTimes(1);
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(1);

  act(() => {
    rendered.rerender({ primeDiscoveredDocuments: secondPrime });
  });

  expect(secondPrime).not.toHaveBeenCalled();
  expect(onDocumentLinksChanged).toHaveBeenCalledTimes(1);
});
