import { expect } from "bun:test";
import {
  captureProjectionHistory,
  omitProjectionHistory,
} from "@tearleads/crypto";
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
