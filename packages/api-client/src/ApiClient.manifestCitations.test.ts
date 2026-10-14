import { expect } from "bun:test";
import {
  type ContainerWriterProjectionResponse,
  encodeContainerWriterProjection,
} from "@tearleads/validators/response";
import { HttpResponse, http } from "msw";
import { createContainerWriterProjectionResponse } from "../test/helpers/apiClientTestFactories";
import {
  apiBaseUrl,
  server,
  testApiClient,
} from "../test/helpers/apiClientTestHarness";
import { ApiClient } from "./ApiClient";
import type { VerifiedManifestCitations } from "./verifiedManifestCitations";

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
        const known = new Set(header ? header.split(",") : []);
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
    expect(hints).toEqual([`${LEAF},${GENESIS}`]);
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
    expect(hints).toEqual([LEAF, null]);
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
