import { expect, test } from "bun:test";
import type { DocumentSummary } from "@tearleads/client-sdk";
import {
  type ProfileDocumentDiscoveryState,
  transitionProfileDocumentDiscovery,
} from "./profileDocumentDiscoveryMachine";

const persisted = (
  document: Partial<DocumentSummary>,
  placementChanged = false,
) =>
  ({
    type: "persisted",
    document: {
      containerId: "other-container",
      documentId: "other-document",
      id: "local",
      title: "",
      updatedAt: "2026-11-01T00:00:00.000Z",
      ...document,
    },
    placementChanged,
  }) as const;

const awaiting: ProfileDocumentDiscoveryState = {
  status: "awaiting",
  containerId: "profile-container",
  documentId: "profile",
};

test("an awaiting profile restarts only for its target or a profile-container placement", () => {
  for (const event of [
    persisted({}),
    persisted({}, true),
    persisted({ containerId: "profile-container" }),
  ])
    expect(transitionProfileDocumentDiscovery(awaiting, event)).toBe(awaiting);
  for (const event of [
    persisted({ documentId: "profile" }),
    persisted({ containerId: "profile-container", documentId: null }, true),
  ])
    expect(transitionProfileDocumentDiscovery(awaiting, event)).toEqual({
      status: "rediscovered",
    });
});

test("settled lookups ignore persisted documents, including the target's saves", () => {
  const idle: ProfileDocumentDiscoveryState = { status: "idle" };
  expect(
    transitionProfileDocumentDiscovery(
      idle,
      persisted({ documentId: "profile" }, true),
    ),
  ).toBe(idle);
});

test("a target persisted mid-lookup restarts a lookup that ends missing", () => {
  const missing = {
    type: "missing",
    containerId: "profile-container",
    documentId: "profile",
  } as const;
  let state = transitionProfileDocumentDiscovery(
    { status: "idle" },
    { type: "resolving", documentId: "profile" },
  );
  const quiet = transitionProfileDocumentDiscovery(state, persisted({}));
  expect(quiet).toBe(state);
  expect(transitionProfileDocumentDiscovery(quiet, missing)).toEqual(awaiting);
  state = transitionProfileDocumentDiscovery(
    state,
    persisted({ documentId: "profile" }),
  );
  expect(transitionProfileDocumentDiscovery(state, missing)).toEqual({
    status: "rediscovered",
  });
});
