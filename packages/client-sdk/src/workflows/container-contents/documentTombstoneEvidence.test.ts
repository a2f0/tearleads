import { expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import type { DocumentWriterProjectionResponse } from "@tearleads/validators/response";
import type { SecurityIncidentContext } from "../../data/securityIncidents";
import {
  createContainerDocumentTombstoneVerifier,
  createDocumentHeadLinkSetLoader,
  type DocumentHeadLinkSetLoaderDeps,
} from "./documentTombstoneEvidence";
import type { ContainerContentsWorkflowRuntime } from "./runtime";

const at = "2026-09-20T00:00:00.000Z";
const projection = {
  documentId: "doc",
  documentManifest: { manifestHash: "head-hash" },
} as unknown as DocumentWriterProjectionResponse;

function createRuntime(input: {
  fetch?: { ok: true } | { ok: false; status: number | null };
}) {
  const calls = {
    evicted: [] as string[],
    incidents: [] as SecurityIncidentContext[],
    logs: [] as string[],
  };
  const runtime = {
    apiClient: {
      evictDocumentWriterProjection: (documentId: string) => {
        calls.evicted.push(documentId);
      },
      getDocumentWriterProjectionResult: async () => {
        const fetch = input.fetch ?? { ok: true };
        return fetch.ok
          ? { data: projection, ok: true as const }
          : {
              message: "denied",
              ok: false as const,
              report: () => {},
              status: fetch.status,
            };
      },
    },
    infra: { execSql: async () => [] },
    resolveTrustedUserIdentity: async () => null,
    util: {
      log: (message: string) => {
        calls.logs.push(message);
      },
      logError: () => {},
      reportSecurityIncident: async (
        _error: unknown,
        context: SecurityIncidentContext,
      ) => {
        calls.incidents.push(context);
      },
    },
  } as unknown as ContainerContentsWorkflowRuntime;
  return { calls, runtime };
}

function deps(
  assertConsistent: DocumentHeadLinkSetLoaderDeps["assertDocumentWriterProjectionConsistent"],
  purged = false,
): DocumentHeadLinkSetLoaderDeps {
  return {
    assertDocumentWriterProjectionConsistent: assertConsistent,
    loadDocumentPurgeCheckpoint: async () =>
      purged
        ? {
            documentId: "doc",
            documentManifestHash: "h",
            organizationId: "org",
            purgeEventHash: "p",
          }
        : null,
  };
}

type AssertConsistent =
  DocumentHeadLinkSetLoaderDeps["assertDocumentWriterProjectionConsistent"];

const verifiedHead = (
  documentId: string,
  linkedContainerIds: string[],
): AssertConsistent =>
  (async (
    _projection: Parameters<AssertConsistent>[0],
    options: Parameters<AssertConsistent>[1],
  ) => {
    options.onVerifiedAuthorization?.({
      containerPathByManifestHash: new Map(),
      documentManifestByHash: new Map([
        ["head-hash", { state: { documentId, linkedContainerIds } }],
      ]),
    } as never);
    return [];
  }) as never;

test("a verified purge checkpoint is terminal evidence without a fetch", async () => {
  const { calls, runtime } = createRuntime({
    fetch: { ok: false, status: 404 },
  });
  const load = createDocumentHeadLinkSetLoader(
    runtime,
    deps(verifiedHead("doc", ["x"]), true),
  );

  expect(await load("doc")).toEqual([]);
  expect(calls.evicted).toEqual([]);
});

test("the cached projection is evicted and the verified head link set returned sorted", async () => {
  const { calls, runtime } = createRuntime({});
  const load = createDocumentHeadLinkSetLoader(
    runtime,
    deps(verifiedHead("doc", ["b", "a", "b"])),
  );

  expect(await load("doc")).toEqual(["a", "b"]);
  expect(calls.evicted).toEqual(["doc"]);
  expect(calls.incidents).toEqual([]);
});

test("a failed fetch yields no evidence", async () => {
  const { calls, runtime } = createRuntime({
    fetch: { ok: false, status: 403 },
  });
  const load = createDocumentHeadLinkSetLoader(
    runtime,
    deps(verifiedHead("doc", ["x"])),
  );

  expect(await load("doc")).toBeNull();
  expect(calls.logs).toEqual([
    "Container contents: tombstone evidence for document doc is unavailable (403)",
  ]);
});

test("a verification failure yields no evidence and reports a security incident", async () => {
  const { calls, runtime } = createRuntime({});
  const load = createDocumentHeadLinkSetLoader(
    runtime,
    deps((async () => {
      throw new KeyingVerificationError("invalid_shape", "tampered");
    }) as never),
  );

  expect(await load("doc")).toBeNull();
  expect(calls.incidents).toEqual([
    {
      objectId: "doc",
      objectKind: "document",
      operation: "document.tombstone-evidence",
    },
  ]);
});

test("a verification that never yields the document's own head is no evidence", async () => {
  const { runtime } = createRuntime({});
  const silent = createDocumentHeadLinkSetLoader(
    runtime,
    deps((async () => []) as never),
  );
  const otherDocument = createDocumentHeadLinkSetLoader(
    runtime,
    deps(verifiedHead("other-doc", ["x"])),
  );

  expect(await silent("doc")).toBeNull();
  expect(await otherDocument("doc")).toBeNull();
});

test("tombstones are judged once per document against the verified head link set", async () => {
  const loads: string[] = [];
  const verify = createContainerDocumentTombstoneVerifier(
    async (documentId) => {
      loads.push(documentId);
      if (documentId === "linked") return ["kept", "still-linked"];
      if (documentId === "purged") return [];
      return null;
    },
  );

  const verdicts = await verify([
    { containerId: "still-linked", documentId: "linked", updatedAt: at },
    { containerId: "gone", documentId: "linked", updatedAt: at },
    { containerId: "anywhere", documentId: "purged", updatedAt: at },
    { containerId: "folder", documentId: "unreadable", updatedAt: at },
  ]);

  expect(loads.sort()).toEqual(["linked", "purged", "unreadable"]);
  expect(verdicts).toEqual([
    {
      kind: "refuted",
      tombstone: {
        containerId: "still-linked",
        documentId: "linked",
        updatedAt: at,
      },
    },
    {
      kind: "verified",
      tombstone: {
        containerId: "gone",
        documentId: "linked",
        linkedContainerIds: ["kept", "still-linked"],
        updatedAt: at,
      },
    },
    {
      kind: "verified",
      tombstone: {
        containerId: "anywhere",
        documentId: "purged",
        linkedContainerIds: [],
        updatedAt: at,
      },
    },
    {
      kind: "unverified",
      tombstone: {
        containerId: "folder",
        documentId: "unreadable",
        updatedAt: at,
      },
    },
  ]);
});

test("head loads run with bounded concurrency and keep verdict order", async () => {
  let inFlight = 0;
  let peak = 0;
  const verify = createContainerDocumentTombstoneVerifier(
    async (documentId) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return [`${documentId}-kept`];
    },
  );

  const verdicts = await verify(
    Array.from({ length: 10 }, (_, index) => ({
      containerId: "gone",
      documentId: `doc-${index}`,
      updatedAt: at,
    })),
  );

  expect(peak).toBeLessThanOrEqual(4);
  expect(peak).toBeGreaterThan(1);
  expect(verdicts.map((verdict) => verdict.tombstone.documentId)).toEqual(
    Array.from({ length: 10 }, (_, index) => `doc-${index}`),
  );
});
