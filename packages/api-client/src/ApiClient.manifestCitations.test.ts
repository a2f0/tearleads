import { expect } from "bun:test";
import { computeContainerKekLevelDigest } from "@tearleads/crypto";
import {
  getContainerWriterProjectionOperation,
  operationRequestPath,
} from "@tearleads/validators/operation";
import {
  type ContainerWriterProjectionResponse,
  type ContainerWriterProjectionWireResponse,
  containerKekWireLevel,
  encodeContainerWriterProjection,
} from "@tearleads/validators/response";
import { parseKnownManifestHints } from "@tearleads/validators/util";
import { HttpResponse, http } from "msw";
import { createContainerWriterProjectionResponse } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  createDeferred,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import { ApiRequestRuntime } from "./apiRequestRuntime";
import type { VerifiedManifestCitations } from "./verifiedManifestCitations";
import { writerProjectionRequests } from "./writerProjectionRequests";

const LEAF = "a".repeat(64);
const GENESIS = "b".repeat(64);

function projection(): ContainerWriterProjectionResponse {
  const fixture = createContainerWriterProjectionResponse();
  const [kek] = fixture.containerKeks;
  const [leaf] = fixture.path;
  if (!kek || !leaf) throw new Error("fixture path missing");
  return {
    ...fixture,
    path: [{ ...leaf, manifestHash: LEAF }],
    containerKeks: [
      {
        ...kek,
        containerManifestHistory: [
          { ...leaf, manifestHash: GENESIS, state: { epoch: 0 } },
        ],
      },
    ],
  };
}

function held(...hashes: string[]): VerifiedManifestCitations {
  const bundles = new Map(
    [
      projection().path[0],
      projection().containerKeks[0]?.containerManifestHistory[0],
    ].flatMap((bundle) =>
      bundle ? [[bundle.manifestHash, bundle] as const] : [],
    ),
  );
  return {
    cite: async () =>
      hashes.flatMap((hash) => {
        const bundle = bundles.get(hash);
        return bundle ? [bundle] : [];
      }),
  };
}

function serve(omit: (known: ReadonlySet<string>) => ReadonlySet<string>) {
  const hints: (string | null)[] = [];
  server.use(
    http.get(
      `${apiBaseUrl}/containers/:containerId/writer-projection`,
      ({ request }) => {
        const header = request.headers.get("x-known-manifests");
        hints.push(header);
        const known = new Set(parseKnownManifestHints(header ?? "")?.manifests);
        return HttpResponse.json(
          encodeContainerWriterProjection(projection(), omit(known)),
        );
      },
    ),
  );
  return hints;
}

testApiClient(
  "a read cites held bundles and rebuilds the positions the API omitted",
  async () => {
    const hints = serve((known) => known);
    const client = new ApiClient(apiBaseUrl);
    client.setVerifiedManifestCitations(held(LEAF, GENESIS));
    expect(
      await client.getContainerWriterProjection(projection().containerId),
    ).toEqual(projection());
    expect(hints).toEqual([`m:${LEAF},m:${GENESIS}`]);
  },
);

testApiClient(
  "a response the cited bytes cannot rebuild refetches once, complete",
  async () => {
    // A server that omits a manifest the request never cited.
    const hints = serve((known) =>
      known.size > 0 ? new Set([...known, GENESIS]) : known,
    );
    const client = new ApiClient(apiBaseUrl);
    client.setVerifiedManifestCitations(held(LEAF));
    const reported: string[] = [];
    client.setOnError((message) => reported.push(message));
    expect(
      await client.getContainerWriterProjection(projection().containerId),
    ).toEqual(projection());
    expect(hints).toEqual([`m:${LEAF}`, null]);
    expect(reported).toEqual([]);
  },
);

testApiClient(
  "a failing citation source or a caller's own headers send no hints",
  async () => {
    const hints = serve((known) => known);
    const client = new ApiClient(apiBaseUrl);
    client.setVerifiedManifestCitations({
      cite: async () => {
        throw new Error("storage unavailable");
      },
    });
    expect(
      await client.getContainerWriterProjection(projection().containerId),
    ).toEqual(projection());
    client.setVerifiedManifestCitations(held(LEAF));
    expect(
      await client.getContainerWriterProjectionResult(
        projection().containerId,
        { headers: { "x-caller": "1" }, reportErrors: false },
      ),
    ).toEqual({ ok: true, data: projection() });
    client.setVerifiedManifestCitations(null);
    client.clearWriterProjectionCaches();
    await client.getContainerWriterProjection(projection().containerId);
    expect(hints).toEqual([null, null, null]);
  },
);

function recordAuthorizedHints() {
  const seen: { authorization: string | null; hint: string | null }[] = [];
  server.use(
    http.get(
      `${apiBaseUrl}/containers/:containerId/writer-projection`,
      ({ request }) => {
        const hint = request.headers.get("x-known-manifests");
        seen.push({
          authorization: request.headers.get("authorization"),
          hint,
        });
        return HttpResponse.json(
          encodeContainerWriterProjection(
            projection(),
            new Set(parseKnownManifestHints(hint ?? "")?.manifests),
          ),
        );
      },
    ),
  );
  return seen;
}

testApiClient(
  "an account switch while citations load sends no hint under the new identity",
  async () => {
    const seen = recordAuthorizedHints();
    const citing = createDeferred<void>();
    const release = createDeferred<void>();
    const client = new ApiClient(apiBaseUrl);
    client.setAuthToken("first-user");
    const { cite } = held(LEAF);
    client.setVerifiedManifestCitations({
      cite: async (target) => {
        citing.resolve();
        await release.promise;
        return cite(target);
      },
    });
    const read = client.getContainerWriterProjectionResult(
      projection().containerId,
      { reportErrors: false },
    );
    await citing.promise;
    client.setAuthToken("second-user");
    release.resolve();
    expect(await read).toMatchObject({ kind: "cancelled", ok: false });
    expect(seen).toEqual([]);
  },
);

testApiClient(
  "an account switch before the complete refetch cancels it",
  async () => {
    const seen: string[] = [];
    server.use(
      http.get(
        `${apiBaseUrl}/containers/:containerId/writer-projection`,
        ({ request }) => {
          seen.push(
            `${request.headers.get("authorization")} ${request.headers.get("x-known-manifests") ?? "-"}`,
          );
          // Omits a manifest the request never cited: a rebuild gap.
          return HttpResponse.json(
            encodeContainerWriterProjection(
              projection(),
              new Set([LEAF, GENESIS]),
            ),
          );
        },
      ),
    );
    const runtime = new ApiRequestRuntime(apiBaseUrl);
    runtime.setAuthToken("first-user");
    const { requestResult } = writerProjectionRequests(runtime, () =>
      held(LEAF),
    );
    const result = await requestResult(
      operationRequestPath(getContainerWriterProjectionOperation, {
        containerId: projection().containerId,
      }),
      // The unusable answer arrives; the account changes before the refetch.
      (value): value is unknown => {
        if (value === null) runtime.setAuthToken("second-user");
        return value !== null;
      },
      "GET",
      undefined,
      { reportErrors: false },
      getContainerWriterProjectionOperation,
    );
    expect(result).toMatchObject({ kind: "cancelled", ok: false });
    expect(seen).toEqual([`Bearer first-user m:${LEAF}`]);
  },
);

function serveLevels(
  stub: (
    wire: ContainerWriterProjectionWireResponse,
    kekLevels: readonly string[],
  ) => ContainerWriterProjectionWireResponse,
) {
  const hints: (string | null)[] = [];
  server.use(
    http.get(
      `${apiBaseUrl}/containers/:containerId/writer-projection`,
      async ({ request }) => {
        const header = request.headers.get("x-known-manifests");
        hints.push(header);
        const parsed = parseKnownManifestHints(header ?? "");
        const digest = await computeContainerKekLevelDigest(
          containerKekWireLevel(projection().containerKeks[0] ?? never()),
        );
        const wire = encodeContainerWriterProjection(
          projection(),
          new Set(parsed?.manifests),
          (kek) =>
            digest !== null &&
            parsed?.kekLevels.includes(digest) &&
            kek.containerId === projection().containerId
              ? digest
              : null,
        );
        return HttpResponse.json(stub(wire, parsed?.kekLevels ?? []));
      },
    ),
  );
  return hints;
}

function never(): never {
  throw new Error("fixture KEK missing");
}

function heldLevel(): VerifiedManifestCitations {
  const level = containerKekWireLevel(projection().containerKeks[0] ?? never());
  return { cite: async () => [level] };
}

testApiClient(
  "a held KEK level is cited by digest and refilled before validation",
  async () => {
    const hints = serveLevels((wire) => wire);
    const client = new ApiClient(apiBaseUrl);
    client.setVerifiedManifestCitations(heldLevel());
    expect(
      await client.getContainerWriterProjection(projection().containerId),
    ).toEqual(projection());
    const digest = await computeContainerKekLevelDigest(
      containerKekWireLevel(projection().containerKeks[0] ?? never()),
    );
    expect(hints).toEqual([`k:${digest}`]);
  },
);

testApiClient(
  "a level stub the held bytes cannot rebuild refetches once, complete",
  async () => {
    // The stub's manifest citations disagree with the held level's.
    const hints = serveLevels((wire, kekLevels) =>
      kekLevels.length === 0
        ? wire
        : {
            ...wire,
            containerKeks: wire.containerKeks.map(() => ({
              levelDigest: kekLevels[0] ?? never(),
              containerManifestHistory: [LEAF],
            })),
            bundles: Object.fromEntries(
              Object.entries(wire.bundles).filter(([hash]) => hash === LEAF),
            ),
          },
    );
    const client = new ApiClient(apiBaseUrl);
    client.setVerifiedManifestCitations(heldLevel());
    const reported: string[] = [];
    client.setOnError((message) => reported.push(message));
    expect(
      await client.getContainerWriterProjection(projection().containerId),
    ).toEqual(projection());
    expect(hints).toHaveLength(2);
    expect(hints[1]).toBeNull();
    expect(reported).toEqual([]);
  },
);

testApiClient(
  "a level stub for a digest the request never cited refetches",
  async () => {
    const hints = serveLevels((wire, kekLevels) =>
      kekLevels.length === 0
        ? wire
        : {
            ...wire,
            containerKeks: wire.containerKeks.map((kek) => ({
              levelDigest: "c".repeat(64),
              containerManifestHistory: kek.containerManifestHistory,
            })),
          },
    );
    const client = new ApiClient(apiBaseUrl);
    client.setVerifiedManifestCitations(heldLevel());
    expect(
      await client.getContainerWriterProjection(projection().containerId),
    ).toEqual(projection());
    expect(hints[1]).toBeNull();
  },
);

testApiClient(
  "a held level whose bytes do not match is never cited",
  async () => {
    const hints = serveLevels((wire) => wire);
    const client = new ApiClient(apiBaseUrl);
    const level = containerKekWireLevel(
      projection().containerKeks[0] ?? never(),
    );
    // Not a KEK level: a source cannot pass arbitrary bytes as one.
    client.setVerifiedManifestCitations({
      cite: async () => [{ ...level, wraps: [] }],
    });
    expect(
      await client.getContainerWriterProjection(projection().containerId),
    ).toEqual(projection());
    expect(hints).toEqual([null]);
  },
);
