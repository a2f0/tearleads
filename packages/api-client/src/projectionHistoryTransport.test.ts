import { expect } from "bun:test";
import {
  captureProjectionHistory,
  omitProjectionHistory,
  restoreProjectionHistory,
} from "@tearleads/crypto";
import { SESSION_ERROR_CODES } from "@tearleads/validators/response";
import { parseProjectionHistoryHints } from "@tearleads/validators/util";
import { HttpResponse, http } from "msw";
import {
  createContainerWriterProjectionResponse,
  createDocumentWriterProjectionResponse,
  createPrincipalPolicyBundleResponse,
} from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { retainVerifiedProjectionHistory } from "./verifiedProjectionHistory";

testApiClient("server prefix mismatch retains complete evidence", () => {
  const full = fixture();
  const retained = captureProjectionHistory(full);
  expect(
    omitProjectionHistory(
      full,
      retained.map((entry) => ({ ...entry.prefix, digest: "0".repeat(64) })),
    ),
  ).toEqual(full);
  expect(
    omitProjectionHistory(
      full,
      retained.map((entry) => ({
        ...entry.prefix,
        count: Number.MAX_SAFE_INTEGER,
      })),
    ),
  ).toEqual(full);
});

testApiClient(
  "unordered multi-chain manifest histories retain every signed entry",
  () => {
    const full = createDocumentWriterProjectionResponse();
    const base = full.documentManifest;
    const entries = (id: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...base,
        manifest: { ...base.manifest, objectId: id, epoch: count - index },
        manifestHash: `${id}-${count - index}`,
      }));
    full.documentManifestHistory = entries("document", 3);
    full.documentContainerManifestHistory = [
      ...entries("parent", 3),
      ...entries("child", 2),
    ];
    const retained = captureProjectionHistory(full);
    full.documentManifestHistory.unshift(...entries("document", 4).slice(0, 1));
    full.documentContainerManifestHistory.unshift(
      ...entries("parent", 4).slice(0, 1),
    );
    const wire = omitProjectionHistory(
      full,
      retained.map((entry) => entry.prefix),
    );
    expect(wire.documentManifestHistory).toHaveLength(1);
    expect(wire.documentContainerManifestHistory).toHaveLength(1);
    expect(restoreProjectionHistory(wire, retained)).toBe(true);
    expect(
      new Map(
        wire.documentManifestHistory.map((entry) => [
          entry.manifestHash,
          entry,
        ]),
      ),
    ).toEqual(
      new Map(
        full.documentManifestHistory.map((entry) => [
          entry.manifestHash,
          entry,
        ]),
      ),
    );
    expect(
      new Map(
        wire.documentContainerManifestHistory.map((entry) => [
          entry.manifestHash,
          entry,
        ]),
      ),
    ).toEqual(
      new Map(
        full.documentContainerManifestHistory.map((entry) => [
          entry.manifestHash,
          entry,
        ]),
      ),
    );
  },
);

testApiClient(
  "hinted retries survive token refresh without restoring cleared cache entries",
  async () => {
    const full = fixture();
    const hinted: boolean[] = [];
    let expire = false;
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:id/writer-projection`,
        ({ request }) => {
          hinted.push(request.headers.has("x-projection-history"));
          if (
            expire &&
            request.headers.get("authorization") === "Bearer old-token"
          )
            return HttpResponse.json(
              {
                code: SESSION_ERROR_CODES.refreshRequired,
                error: "Session expired",
              },
              { status: 401 },
            );
          return HttpResponse.json(
            omitProjectionHistory(
              full,
              parseProjectionHistoryHints(
                request.headers.get("x-projection-history") ?? "[]",
              ) ?? [],
            ),
          );
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("old-token");
    let refreshes = 0;
    client.setOnSessionExpired(() => {
      refreshes++;
      client.setAuthToken("fresh-token");
      return true;
    });
    const first = await client.getContainerWriterProjection(full.containerId);
    if (!first) throw new Error("Expected initial projection");
    retainVerifiedProjectionHistory(first);
    client.clearWriterProjectionCaches();
    expire = true;
    const refreshed = await client.getContainerWriterProjection(
      full.containerId,
    );
    expect(refreshed).toEqual(full);
    expect(refreshes).toBe(1);
    expect(hinted).toEqual([false, true, true]);
    if (!refreshed) throw new Error("Expected retried projection");
    retainVerifiedProjectionHistory(refreshed);
    client.clearWriterProjectionCaches();
    await client.getContainerWriterProjection(full.containerId);
    expect(hinted.at(-1)).toBe(false);
  },
);

testApiClient(
  "ambiguous duplicate history slots use complete evidence",
  async () => {
    const full = fixture();
    const group = full.policyEvidence.groups[0];
    if (!group) throw new Error("Expected group");
    full.policyEvidence.groups.push(structuredClone(group));
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:id/writer-projection`,
        ({ request }) => {
          const hints = parseProjectionHistoryHints(
            request.headers.get("x-projection-history") ?? "[]",
          );
          if (!hints)
            return HttpResponse.json(
              { error: "Invalid hints" },
              { status: 400 },
            );
          return HttpResponse.json(omitProjectionHistory(full, hints));
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    const first = await client.getContainerWriterProjection(full.containerId);
    if (!first) throw new Error("Expected initial projection");
    retainVerifiedProjectionHistory(first);
    client.clearWriterProjectionCaches();
    expect(await client.getContainerWriterProjection(full.containerId)).toEqual(
      full,
    );
  },
);

testApiClient(
  "history cache eviction and late admission after logout fall back to full evidence",
  async () => {
    const requested: boolean[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:id/writer-projection`,
        ({ params, request }) => {
          const full = fixture();
          const id = String(Reflect.get(params, "id"));
          full.containerId = id;
          const manifest = full.path[0];
          const kek = full.containerKeks[0];
          if (!manifest || !kek) throw new Error("Missing path");
          Reflect.set(manifest.manifest, "objectId", id);
          Reflect.set(manifest.state, "containerId", id);
          kek.containerId = id;
          Reflect.set(kek.keyEpoch, "containerId", id);
          requested.push(request.headers.has("x-projection-history"));
          return HttpResponse.json(
            omitProjectionHistory(
              full,
              parseProjectionHistoryHints(
                request.headers.get("x-projection-history") ?? "[]",
              ) ?? [],
            ),
          );
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    for (let index = 0; index < 17; index++) {
      const projection = await client.getContainerWriterProjection(
        `container-${index}`,
      );
      if (!projection) throw new Error("Expected history candidate");
      retainVerifiedProjectionHistory(projection);
    }
    client.clearWriterProjectionCaches();
    const evicted = await client.getContainerWriterProjection("container-0");
    expect(requested.at(-1)).toBe(false);
    if (!evicted) throw new Error("Expected cold fallback");
    client.setAuthToken("new-login");
    retainVerifiedProjectionHistory(evicted);
    await client.getContainerWriterProjection("container-0");
    expect(requested.at(-1)).toBe(false);
  },
);

function fixture() {
  const projection = createContainerWriterProjectionResponse();
  const policy = createPrincipalPolicyBundleResponse();
  policy.previousStates = Array.from({ length: 16 }, (_, index) => ({
    state: {
      ...policy.currentState,
      version: index + 1,
      signature: "s".repeat(6000),
    },
    grants: policy.currentGrants,
    projection: policy.currentProjection,
  }));
  projection.policyEvidence.groups = [policy];
  const kek = projection.containerKeks[0];
  const manifest = projection.path[0];
  if (!kek || !manifest) throw new Error("Expected fixture path");
  kek.containerManifestHistory = [
    { ...manifest, manifest: { ...manifest.manifest, epoch: 1 } },
  ];
  return projection;
}

testApiClient(
  "only admitted evidence supplies hints; prefixes restore a growing policy and survive head eviction",
  async () => {
    const full = fixture();
    const hints: string[] = [];
    const bytes: number[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:id/writer-projection`,
        ({ request }) => {
          const hint = request.headers.get("x-projection-history") ?? "[]";
          hints.push(hint);
          const wire = omitProjectionHistory(
            full,
            parseProjectionHistoryHints(hint) ?? [],
          );
          bytes.push(JSON.stringify(wire).length);
          return HttpResponse.json(wire);
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    const first = await client.getContainerWriterProjection(full.containerId);
    if (!first) throw new Error("Missing projection");
    client.clearWriterProjectionCaches();
    await client.getContainerWriterProjection(full.containerId);
    expect(hints).toEqual(["[]", "[]"]);
    retainVerifiedProjectionHistory(first);
    const group = full.policyEvidence.groups[0];
    const previous = group?.previousStates.at(-1);
    if (!group || !previous) throw new Error("Missing history");
    group.previousStates.push({
      ...previous,
      state: { ...previous.state, version: 17 },
    });
    client.clearWriterProjectionCaches();
    const second = await client.getContainerWriterProjectionResult(
      full.containerId,
    );
    expect(second).toEqual({ ok: true, data: full });
    expect(hints[2]).not.toBe("[]");
    expect(bytes[2]).toBeLessThan((bytes[0] ?? 0) / 3);
    client.setAuthToken("new-session");
    await client.getContainerWriterProjection(full.containerId);
    expect(hints[3]).toBe("[]");
  },
);

testApiClient(
  "missing or altered bases and cross-organization prefixes cannot be substituted",
  async () => {
    const full = fixture();
    let corrupt = false;
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:id/writer-projection`,
        ({ request }) => {
          const hints =
            parseProjectionHistoryHints(
              request.headers.get("x-projection-history") ?? "[]",
            ) ?? [];
          const wire = omitProjectionHistory(
            full,
            hints.length
              ? hints
              : captureProjectionHistory(full).map((entry) => entry.prefix),
          );
          if (corrupt && wire.historyPrefixes?.[0])
            wire.historyPrefixes[0].digest = "0".repeat(64);
          return HttpResponse.json(wire);
        },
      ),
    );
    const cold = new ApiClient(apiBaseUrl);
    expect(
      (
        await cold.getContainerWriterProjectionResult(full.containerId, {
          reportErrors: false,
        })
      ).ok,
    ).toBe(false);
    server.use(
      http.get(`${apiBaseUrl}/containers/:id/writer-projection`, () =>
        HttpResponse.json(full),
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    const original = await client.getContainerWriterProjection(
      full.containerId,
    );
    if (!original) throw new Error("Expected full proof");
    retainVerifiedProjectionHistory(original);
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:id/writer-projection`,
        ({ request }) => {
          const hints =
            parseProjectionHistoryHints(
              request.headers.get("x-projection-history") ?? "[]",
            ) ?? [];
          const wire = omitProjectionHistory(full, hints);
          if (corrupt && wire.historyPrefixes?.[0])
            wire.historyPrefixes[0].digest = "0".repeat(64);
          else wire.organizationId = "different-organization";
          return HttpResponse.json(wire);
        },
      ),
    );
    client.clearWriterProjectionCaches();
    expect(
      (
        await client.getContainerWriterProjectionResult(full.containerId, {
          reportErrors: false,
        })
      ).ok,
    ).toBe(false);
    corrupt = true;
    client.clearWriterProjectionCaches();
    expect(
      (
        await client.getContainerWriterProjectionResult(full.containerId, {
          reportErrors: false,
        })
      ).ok,
    ).toBe(false);
  },
);

testApiClient(
  "mutated candidates never seed history and an ignored hint falls back to complete evidence",
  async () => {
    const full = fixture();
    const hints: string[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:id/writer-projection`,
        ({ request }) => {
          hints.push(request.headers.get("x-projection-history") ?? "[]");
          return HttpResponse.json(full);
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    const first = await client.getContainerWriterProjection(full.containerId);
    if (!first?.policyEvidence.groups[0]?.previousStates[0])
      throw new Error("Expected history");
    first.policyEvidence.groups[0].previousStates[0].state.signature =
      "altered";
    retainVerifiedProjectionHistory(first);
    client.clearWriterProjectionCaches();
    const second = await client.getContainerWriterProjection(full.containerId);
    expect(hints[1]).toBe("[]");
    if (!second) throw new Error("Expected full proof");
    retainVerifiedProjectionHistory(second);
    client.clearWriterProjectionCaches();
    expect(await client.getContainerWriterProjection(full.containerId)).toEqual(
      full,
    );
    expect(hints[2]).not.toBe("[]");
  },
);

testApiClient(
  "document projections reconstruct principal and manifest evidence",
  async () => {
    const full = createDocumentWriterProjectionResponse();
    Reflect.set(full, "containerId", "unrelated-extra-field");
    const container = fixture();
    const { policyEvidence, ...path } = container;
    full.policyEvidence = policyEvidence;
    full.authorizingContainerPaths = [path];
    full.documentManifestHistory = [full.documentManifest];
    const ancestor = path.path[0];
    if (!ancestor) throw new Error("Expected container manifest");
    full.documentManifestContainerPaths = [
      [
        ancestor,
        {
          ...ancestor,
          manifest: { ...ancestor.manifest, objectId: "historical-child" },
        },
      ],
    ];
    let compressed = false;
    server.use(
      http.get(
        `${apiBaseUrl}/documents/:id/writer-projection`,
        ({ request }) => {
          const hints =
            parseProjectionHistoryHints(
              request.headers.get("x-projection-history") ?? "[]",
            ) ?? [];
          const wire = omitProjectionHistory(full, hints);
          compressed = (wire.historyPrefixes?.length ?? 0) > 0;
          return HttpResponse.json(wire);
        },
      ),
    );
    const client = new ApiClient(apiBaseUrl);
    const first = await client.getDocumentWriterProjection(full.documentId);
    if (!first) throw new Error("Expected full projection");
    retainVerifiedProjectionHistory(first);
    client.clearWriterProjectionCaches();
    expect(
      await client.getDocumentWriterProjectionResult(full.documentId),
    ).toEqual({ ok: true, data: full });
    expect(compressed).toBe(true);
  },
);
