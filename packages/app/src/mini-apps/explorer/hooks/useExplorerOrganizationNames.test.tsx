import { afterEach, expect, mock, test } from "bun:test";
import type {
  ContainerNode,
  LocalOrganizationSummary,
} from "@symcrypt/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@symcrypt/client-sdk";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useExplorerOrganizationNames } from "./useExplorerOrganizationNames";

afterEach(() => cleanup());

// The hook keys re-resolution off the `nodes` snapshot reference, so tests pass
// a fresh array to simulate a container-store update.
function rootNode(organizationId: string, id = organizationId): ContainerNode {
  return {
    id,
    kind: "container",
    name: `${id}-root`,
    organizationId,
    parentId: null,
    syncState: syncedContainerDocumentObjectSyncState,
  };
}

function summary(
  organizationId: string,
  name: string | null,
): LocalOrganizationSummary {
  return { name, organizationId, rootContainerId: `${organizationId}-root` };
}

// A fake loader whose return value can be swapped between renders, so a test can
// model a name that only decrypts on a *later* sync. Tracks its call count so we
// can assert the hook stops querying once every foreign org is named.
function createLoader(initial: LocalOrganizationSummary[]) {
  let summaries = initial;
  const load = mock(() => Promise.resolve(summaries));
  return {
    load,
    setSummaries: (next: LocalOrganizationSummary[]) => {
      summaries = next;
    },
  };
}

test("resolves names only for foreign organizations, ignoring the primary and null names", async () => {
  const { load } = createLoader([
    summary("org-primary", "My Org"),
    summary("org-acme", "Acme Corp"),
    summary("org-pending", null),
  ]);
  const nodes = [
    rootNode("org-primary"),
    rootNode("org-acme"),
    rootNode("org-pending"),
  ];

  const { result } = renderHook(() =>
    useExplorerOrganizationNames({
      listLocalOrganizations: load,
      nodes,
      primaryOrganizationId: "org-primary",
      ready: true,
    }),
  );

  await waitFor(() => expect(result.current.size).toBe(1));
  // Only org-acme: org-primary is the user's own org (never a heading) and
  // org-pending has no decrypted name yet.
  expect(result.current.get("org-acme")).toBe("Acme Corp");
  expect(result.current.has("org-primary")).toBe(false);
  expect(result.current.has("org-pending")).toBe(false);
});

test("stays empty and never queries when there are no foreign organizations", () => {
  const { load } = createLoader([summary("org-primary", "My Org")]);

  const { result } = renderHook(() =>
    useExplorerOrganizationNames({
      listLocalOrganizations: load,
      nodes: [rootNode("org-primary")],
      primaryOrganizationId: "org-primary",
      ready: true,
    }),
  );

  // renderHook flushes effects synchronously, so this proves the DB-backed
  // lookup was skipped outright (not merely "not yet called").
  expect(load).toHaveBeenCalledTimes(0);
  expect(result.current.size).toBe(0);
});

test("does not resolve until ready", async () => {
  const { load } = createLoader([summary("org-acme", "Acme Corp")]);
  const nodes = [rootNode("org-primary"), rootNode("org-acme")];

  const { result, rerender } = renderHook(
    ({ ready }: { ready: boolean }) =>
      useExplorerOrganizationNames({
        listLocalOrganizations: load,
        nodes,
        primaryOrganizationId: "org-primary",
        ready,
      }),
    { initialProps: { ready: false } },
  );

  // Effects have flushed by now; while not ready the lookup must not fire.
  expect(load).toHaveBeenCalledTimes(0);
  expect(result.current.size).toBe(0);

  rerender({ ready: true });
  await waitFor(() => expect(result.current.get("org-acme")).toBe("Acme Corp"));
});

test("picks up a name that only decrypts on a later container sync", async () => {
  // This is the case a set-only gate (Gemini's original suggestion) would miss:
  // the foreign org's root appears first (name still null), and the name lands
  // on a subsequent sync without the foreign-org id set changing.
  const loader = createLoader([summary("org-acme", null)]);
  const nodesBefore = [rootNode("org-primary"), rootNode("org-acme")];
  const nodesAfter = [rootNode("org-primary"), rootNode("org-acme")];

  const { result, rerender } = renderHook(
    ({ nodes }: { nodes: ContainerNode[] }) =>
      useExplorerOrganizationNames({
        listLocalOrganizations: loader.load,
        nodes,
        primaryOrganizationId: "org-primary",
        ready: true,
      }),
    { initialProps: { nodes: nodesBefore } },
  );

  // First pass: org-acme is present but unnamed, so no heading name yet.
  await waitFor(() => expect(loader.load).toHaveBeenCalledTimes(1));
  expect(result.current.has("org-acme")).toBe(false);

  // The profile decrypts locally; the next container-snapshot change re-resolves
  // (the id set is unchanged, but the org is still unnamed).
  loader.setSummaries([summary("org-acme", "Acme Corp")]);
  rerender({ nodes: nodesAfter });

  await waitFor(() => expect(result.current.get("org-acme")).toBe("Acme Corp"));
});

test("stops querying once every foreign organization is named and the set is stable", async () => {
  const loader = createLoader([summary("org-acme", "Acme Corp")]);

  const { result, rerender } = renderHook(
    ({ nodes }: { nodes: ContainerNode[] }) =>
      useExplorerOrganizationNames({
        listLocalOrganizations: loader.load,
        nodes,
        primaryOrganizationId: "org-primary",
        ready: true,
      }),
    {
      initialProps: {
        nodes: [rootNode("org-primary"), rootNode("org-acme")],
      },
    },
  );

  await waitFor(() => expect(result.current.get("org-acme")).toBe("Acme Corp"));
  expect(loader.load).toHaveBeenCalledTimes(1);

  // A container update that does not change the foreign-org set (a fresh nodes
  // array with the same orgs) must not trigger another DB lookup, because the
  // one foreign org is already named.
  rerender({ nodes: [rootNode("org-primary"), rootNode("org-acme")] });
  rerender({ nodes: [rootNode("org-primary"), rootNode("org-acme")] });

  await waitFor(() => expect(result.current.get("org-acme")).toBe("Acme Corp"));
  expect(loader.load).toHaveBeenCalledTimes(1);
});

test("does not start a second lookup while one for the same orgs is in flight", async () => {
  // The first lookup hangs until we resolve it, modelling a slow local query
  // that a sync burst re-renders over.
  let resolveFirst:
    | ((summaries: LocalOrganizationSummary[]) => void)
    | undefined;
  const load = mock(() => {
    if (!resolveFirst) {
      return new Promise<LocalOrganizationSummary[]>((resolve) => {
        resolveFirst = resolve;
      });
    }
    return Promise.resolve([summary("org-acme", "Acme Corp")]);
  });

  const { result, rerender } = renderHook(
    ({ nodes }: { nodes: ContainerNode[] }) =>
      useExplorerOrganizationNames({
        listLocalOrganizations: load,
        nodes,
        primaryOrganizationId: "org-primary",
        ready: true,
      }),
    {
      initialProps: { nodes: [rootNode("org-primary"), rootNode("org-acme")] },
    },
  );

  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

  // Sync churn re-renders with the same foreign-org set while the first lookup
  // is still pending; the in-flight one must be left to finish, not restarted.
  rerender({ nodes: [rootNode("org-primary"), rootNode("org-acme")] });
  rerender({ nodes: [rootNode("org-primary"), rootNode("org-acme")] });
  expect(load).toHaveBeenCalledTimes(1);

  // Resolving that same in-flight lookup still lands its result.
  resolveFirst?.([summary("org-acme", "Acme Corp")]);
  await waitFor(() => expect(result.current.get("org-acme")).toBe("Acme Corp"));
  expect(load).toHaveBeenCalledTimes(1);
});

test("re-queries and prunes when a foreign organization is removed", async () => {
  const loader = createLoader([
    summary("org-acme", "Acme Corp"),
    summary("org-widgets", "Widgets Inc"),
  ]);

  const { result, rerender } = renderHook(
    ({ nodes }: { nodes: ContainerNode[] }) =>
      useExplorerOrganizationNames({
        listLocalOrganizations: loader.load,
        nodes,
        primaryOrganizationId: "org-primary",
        ready: true,
      }),
    {
      initialProps: {
        nodes: [
          rootNode("org-primary"),
          rootNode("org-acme"),
          rootNode("org-widgets"),
        ],
      },
    },
  );

  await waitFor(() => expect(result.current.size).toBe(2));

  // Widgets is unshared/removed: the set shrank, so the hook re-resolves and the
  // pruned org drops out of the map.
  rerender({ nodes: [rootNode("org-primary"), rootNode("org-acme")] });

  await waitFor(() => expect(result.current.size).toBe(1));
  expect(result.current.get("org-acme")).toBe("Acme Corp");
  expect(result.current.has("org-widgets")).toBe(false);
});

test("swallows loader failures and keeps the last resolved names", async () => {
  let shouldReject = false;
  const load = mock(() =>
    shouldReject
      ? Promise.reject(new Error("db unavailable"))
      : Promise.resolve([summary("org-acme", "Acme Corp")]),
  );

  const { result, rerender } = renderHook(
    ({ nodes }: { nodes: ContainerNode[] }) =>
      useExplorerOrganizationNames({
        listLocalOrganizations: load,
        nodes,
        primaryOrganizationId: "org-primary",
        ready: true,
      }),
    {
      initialProps: { nodes: [rootNode("org-primary"), rootNode("org-acme")] },
    },
  );

  await waitFor(() => expect(result.current.get("org-acme")).toBe("Acme Corp"));

  // Adding a new foreign org changes the set, which forces a fresh lookup — and
  // that one rejects. The hook must not throw and must retain the known name.
  shouldReject = true;
  rerender({
    nodes: [
      rootNode("org-primary"),
      rootNode("org-acme"),
      rootNode("org-widgets"),
    ],
  });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  expect(result.current.get("org-acme")).toBe("Acme Corp");
});

test("re-resolves a pending name after its profile syncs, without a container change", async () => {
  // Model the real gap this retry closes: a foreign org's name arrives via its
  // org-profile document *after* the container tree has settled, so `nodes` never
  // changes again. The container-driven effect alone would leave it unnamed; the
  // bounded retry timer re-queries until it resolves.
  const { load, setSummaries } = createLoader([summary("org-acme", null)]);
  const nodes = [rootNode("org-primary"), rootNode("org-acme")];

  const { result } = renderHook(() =>
    useExplorerOrganizationNames({
      listLocalOrganizations: load,
      nodes,
      primaryOrganizationId: "org-primary",
      ready: true,
    }),
  );

  await waitFor(() => expect(load).toHaveBeenCalled());
  expect(result.current.has("org-acme")).toBe(false);

  // The profile document syncs in; the same `nodes` array is still in effect.
  setSummaries([summary("org-acme", "Acme Corp")]);

  await waitFor(
    () => expect(result.current.get("org-acme")).toBe("Acme Corp"),
    {
      timeout: 5_000,
    },
  );
});
