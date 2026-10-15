import { expect } from "bun:test";
import {
  getContainerWriterProjectionOperation,
  operationRequestPath,
} from "@tearleads/validators/operation";
import {
  type ContainerWriterProjectionResponse,
  encodeContainerWriterProjection,
} from "@tearleads/validators/response";
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
            new Set(hint ? hint.split(",") : []),
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
    expect(seen).toEqual([`Bearer first-user ${LEAF}`]);
  },
);
