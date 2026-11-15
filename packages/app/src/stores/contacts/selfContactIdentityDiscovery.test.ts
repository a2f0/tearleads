import { expect, test } from "bun:test";
import type {
  DocumentSummary,
  LocalProjectionSnapshot,
} from "@tearleads/client-sdk";
import { subscribeToSelfContactIdentityDiscovery } from "./selfContactIdentityDiscovery";

const alias: DocumentSummary = {
  id: "outside-contacts-alias",
  documentId: "canonical-stream",
  containerId: "other-folder",
  documentKind: "note",
  title: "Discovery shell",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

function snapshot(
  rows: readonly DocumentSummary[] = [alias],
  bucket = "other-folder",
): LocalProjectionSnapshot {
  return {
    ready: true,
    containers: [],
    documentSummariesByContainerId: new Map([[bucket, rows]]),
    linkedContainerIdsByDocumentId: new Map(),
  };
}

function observe(initial: LocalProjectionSnapshot) {
  let current = initial;
  let listener: () => void = () => undefined;
  let calls = 0;
  const stop = subscribeToSelfContactIdentityDiscovery(
    {
      getSnapshot: () => current,
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = () => undefined;
        };
      },
    },
    () => calls++,
  );
  return {
    calls: () => calls,
    emit(next: LocalProjectionSnapshot) {
      current = next;
      listener();
    },
    stop,
  };
}

test("identity discovery ignores reordered rows and content/access/tree metadata", () => {
  const second = { ...alias, id: "another-alias" };
  const observed = observe(snapshot([alias, second]));
  try {
    observed.emit(snapshot([{ ...second }, { ...alias }]));
    observed.emit(
      snapshot([
        { ...alias, title: "New name", documentKind: "contact" },
        {
          ...second,
          updatedAt: "2026-11-02T00:00:00.000Z",
          effectiveAccessLevel: "read",
          accessStateHash: "changed-access",
        },
      ]),
    );
    observed.emit({
      ...snapshot([alias, second]),
      containers: [
        {
          id: "other-folder",
          kind: "container",
          name: "Renamed folder",
          organizationId: "organization",
          parentId: null,
          syncState: {
            lastError: null,
            pendingAttachmentBytes: 0,
            pendingAttachmentCount: 0,
            pendingUpdateCount: 0,
            status: "synced",
          },
        },
      ],
    });
    expect(observed.calls()).toBe(0);
  } finally {
    observed.stop();
  }
});

const changes: Array<[string, LocalProjectionSnapshot]> = [
  ["readiness", { ...snapshot(), ready: false }],
  ["removal", snapshot([])],
  ["new note-kind alias", snapshot([alias, { ...alias, id: "new-alias" }])],
  ["local ID", snapshot([{ ...alias, id: "replacement-alias" }])],
  ["current identity", snapshot([{ ...alias, documentId: "other-stream" }])],
  ["cleared identity", snapshot([{ ...alias, documentId: null }])],
  ["record placement", snapshot([{ ...alias, containerId: "new-folder" }])],
  ["bucket membership", snapshot([alias], "new-folder")],
  [
    "all buckets removed",
    { ...snapshot(), documentSummariesByContainerId: new Map() },
  ],
];

test.each(changes)(
  "identity discovery retains %s invalidation",
  (_name, next) => {
    const observed = observe(snapshot());
    try {
      observed.emit(next);
      expect(observed.calls()).toBe(1);
      observed.emit(next);
      expect(observed.calls()).toBe(1);
    } finally {
      observed.stop();
    }
  },
);

test("first discovery of a note-kind canonical shell invalidates", () => {
  const observed = observe(snapshot([]));
  observed.emit(snapshot());
  expect(observed.calls()).toBe(1);
  observed.stop();
  observed.emit(snapshot([]));
  expect(observed.calls()).toBe(1);
});
