import { describe, expect, test } from "bun:test";
import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import {
  type ContainerDependencyLoadState,
  type LoadedProjectionManifestBundle,
  loadContainerDependencyPath,
  loadDocumentContainerDependencyMaterial,
  loadDocumentManifestHistory,
} from "./writerProjection";
import { DocumentWriterProjectionError } from "./writerProjectionError";

// Every bundle these walks need is cached, so the executor is never reached.
const unusedExecutor = {} as unknown as DatabaseSession;

async function rejection(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DocumentWriterProjectionError && error.status === 409)
      return error.message;
    throw error;
  }
  throw new Error("expected a rejection");
}

function bundle(
  manifestHash: string,
  parts: Partial<Record<"event" | "manifest" | "state", unknown>> = {},
): AccessManifestBundleWireResponse {
  const value: Record<string, unknown> = {
    event: { event: { dependencyManifestHashes: [] } },
    manifest: { previousManifestHash: null },
    manifestHash,
    state: { parentManifestHash: null },
    ...parts,
  };
  return Object.assign(Object.create(null), value);
}

function cacheOf(
  entries: readonly [
    AccessManifestBundleWireResponse,
    LoadedProjectionManifestBundle["objectKind"],
  ][],
): Map<string, LoadedProjectionManifestBundle> {
  return new Map(
    entries.map(([value, objectKind]) => [
      value.manifestHash,
      { bundle: value, objectKind },
    ]),
  );
}

describe("document manifest history fields", () => {
  const history = (
    documentManifest: AccessManifestBundleWireResponse,
    cached: Map<string, LoadedProjectionManifestBundle> = new Map(),
  ) =>
    loadDocumentManifestHistory({
      documentManifest,
      executor: unusedExecutor,
      manifestCache: cached,
    });

  test.each([
    [
      "a non-object manifest",
      { manifest: [] },
      "Document writer projection manifest manifest is invalid",
    ],
    [
      "a missing previous hash",
      { manifest: {} },
      "Document writer projection manifest.previousManifestHash is invalid",
    ],
    [
      "a numeric previous hash",
      { manifest: { previousManifestHash: 1 } },
      "Document writer projection manifest.previousManifestHash is invalid",
    ],
  ])("rejects %s", async (_name, parts, message) => {
    expect(await rejection(() => history(bundle("head", parts)))).toBe(message);
  });

  test("walks cached predecessors and labels their fields as history", async () => {
    const head = bundle("head", { manifest: { previousManifestHash: "p1" } });
    const p1 = bundle("p1", { manifest: { previousManifestHash: "" } });
    expect(await history(head, cacheOf([[p1, "document"]]))).toEqual([p1]);
    const bad = bundle("p1", { manifest: { previousManifestHash: false } });
    expect(
      await rejection(() => history(head, cacheOf([[bad, "document"]]))),
    ).toBe(
      "Document writer projection manifest history.previousManifestHash is invalid",
    );
  });
});

describe("document event citations", () => {
  const material = (
    documentManifest: AccessManifestBundleWireResponse,
    documentManifestHistory: AccessManifestBundleWireResponse[] = [],
  ) =>
    loadDocumentContainerDependencyMaterial({
      documentManifest,
      documentManifestHistory,
      executor: unusedExecutor,
      manifestCache: new Map(),
    });

  test.each([
    [
      "a non-object event bundle",
      { event: null },
      "Document writer projection manifest event bundle is invalid",
    ],
    [
      "a non-object event",
      { event: { event: [] } },
      "Document writer projection manifest event is invalid",
    ],
    [
      "a missing event",
      { event: {} },
      "Document writer projection manifest event is invalid",
    ],
    [
      "string citations",
      { event: { event: { dependencyManifestHashes: "x" } } },
      "Document writer projection manifest event dependencyManifestHashes is invalid",
    ],
    [
      "a numeric citation",
      { event: { event: { dependencyManifestHashes: ["a", 1] } } },
      "Document writer projection manifest event dependencyManifestHashes is invalid",
    ],
  ])("rejects %s", async (_name, parts, message) => {
    expect(await rejection(() => material(bundle("head", parts)))).toBe(
      message,
    );
  });

  test("labels history citations by their index", async () => {
    expect(
      await rejection(() =>
        material(bundle("head"), [bundle("h0"), bundle("h1", { event: 1 })]),
      ),
    ).toBe(
      "Document writer projection manifest history[1] event bundle is invalid",
    );
  });
});

describe("container dependency fields", () => {
  const walk = (cached: Map<string, LoadedProjectionManifestBundle>) => {
    const state: ContainerDependencyLoadState = {
      containerHistoryByHash: new Map(),
      containerPathsByLeafHash: new Map(),
      executor: unusedExecutor,
      manifestCache: cached,
      walkedCitations: new Set(),
      walkedContainerPredecessors: new Set(),
    };
    return loadContainerDependencyPath({
      leafManifestHash: "leaf",
      state,
    }).then(() => state.containerPathsByLeafHash.get("leaf"));
  };

  test("follows parents and rejects malformed container fields", async () => {
    const leaf = bundle("leaf", { state: { parentManifestHash: "root" } });
    const root = bundle("root");
    expect(
      await walk(
        cacheOf([
          [leaf, "container"],
          [root, "container"],
        ]),
      ),
    ).toEqual([root, leaf]);

    const cases: [AccessManifestBundleWireResponse, string][] = [
      [
        bundle("leaf", { state: null }),
        "Document writer projection container dependency state is invalid",
      ],
      [
        bundle("leaf", { state: {} }),
        "Document writer projection container dependency.parentManifestHash is invalid",
      ],
      [
        bundle("leaf", { manifest: "m" }),
        "Document writer projection container dependency manifest is invalid",
      ],
      [
        bundle("leaf", {
          event: { event: { dependencyManifestHashes: null } },
        }),
        "Document writer projection container dependency event dependencyManifestHashes is invalid",
      ],
    ];
    for (const [value, message] of cases) {
      expect(await rejection(() => walk(cacheOf([[value, "container"]])))).toBe(
        message,
      );
    }
  });

  test("labels a predecessor's fields as dependency history", async () => {
    const leaf = bundle("leaf", { manifest: { previousManifestHash: "old" } });
    const old = bundle("old", { manifest: { previousManifestHash: 3 } });
    expect(
      await rejection(() =>
        walk(
          cacheOf([
            [leaf, "container"],
            [old, "container"],
          ]),
        ),
      ),
    ).toBe(
      "Document writer projection container dependency history.previousManifestHash is invalid",
    );
  });
});
