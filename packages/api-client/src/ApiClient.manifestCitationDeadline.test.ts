import { expect } from "bun:test";
import {
  getContainerWriterProjectionOperation,
  operationRequestPath,
} from "@tearleads/validators/operation";
import {
  type ContainerWriterProjectionResponse,
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
import {
  MANIFEST_CITATION_DEADLINE_MS,
  type VerifiedManifestCitations,
} from "./verifiedManifestCitations";
import { writerProjectionRequests } from "./writerProjectionRequests";

const LEAF = "a".repeat(64);

function projection(): ContainerWriterProjectionResponse {
  const fixture = createContainerWriterProjectionResponse();
  const [leaf] = fixture.path;
  if (!leaf) throw new Error("fixture path missing");
  return { ...fixture, path: [{ ...leaf, manifestHash: LEAF }] };
}

function serve() {
  const hints: (string | null)[] = [];
  server.use(
    http.get(
      `${apiBaseUrl}/containers/:containerId/writer-projection`,
      ({ request }) => {
        const hint = request.headers.get("x-known-manifests");
        hints.push(hint);
        return HttpResponse.json(
          encodeContainerWriterProjection(
            projection(),
            new Set(parseKnownManifestHints(hint ?? "")?.manifests),
          ),
        );
      },
    ),
  );
  return hints;
}

/** Settles within `ms`, or reports that it did not. */
function within<T>(promise: Promise<T>, ms: number) {
  return Promise.race([
    promise.then((value) => ({ settled: true as const, value })),
    new Promise<{ settled: false }>((resolve) =>
      setTimeout(() => resolve({ settled: false }), ms),
    ),
  ]);
}

const bound = MANIFEST_CITATION_DEADLINE_MS + 1_000;

testApiClient(
  "a citation source that never answers delays the read by at most its bound",
  async () => {
    const hints = serve();
    const client = new ApiClient(apiBaseUrl);
    client.setVerifiedManifestCitations({
      cite: () => new Promise(() => {}),
    });
    const read = await within(
      client.getContainerWriterProjectionResult(projection().containerId, {
        reportErrors: false,
      }),
      bound,
    );
    expect(read).toEqual({
      settled: true,
      value: { ok: true, data: projection() },
    });
    expect(hints).toEqual([null]);
  },
);

testApiClient(
  "a citation source that rejects or throws sends the read uncited",
  async () => {
    const hints = serve();
    const client = new ApiClient(apiBaseUrl);
    const sources: VerifiedManifestCitations[] = [
      { cite: async () => Promise.reject(new Error("storage failed")) },
      {
        cite: () => {
          throw new Error("storage failed synchronously");
        },
      },
    ];
    for (const source of sources) {
      client.setVerifiedManifestCitations(source);
      client.clearWriterProjectionCaches();
      expect(
        await client.getContainerWriterProjection(projection().containerId),
      ).toEqual(projection());
    }
    expect(hints).toEqual([null, null]);
  },
);

testApiClient(
  "a citation answer after the bound cannot change the read already sent",
  async () => {
    const hints = serve();
    const late = createDeferred<void>();
    const client = new ApiClient(apiBaseUrl);
    client.setVerifiedManifestCitations({
      cite: async () => {
        await late.promise;
        return [projection().path[0]].flatMap((bundle) =>
          bundle ? [bundle] : [],
        );
      },
    });
    const read = await within(
      client.getContainerWriterProjection(projection().containerId),
      bound,
    );
    late.resolve();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(read).toEqual({ settled: true, value: projection() });
    expect(hints).toEqual([null]);
  },
);

testApiClient(
  "aborting while citations load cancels the read without a request",
  async () => {
    const hints = serve();
    const citing = createDeferred<void>();
    const runtime = new ApiRequestRuntime(apiBaseUrl);
    const { requestResult } = writerProjectionRequests(runtime, () => ({
      cite: () => {
        citing.resolve();
        return new Promise(() => {});
      },
    }));
    const controller = new AbortController();
    const pending = requestResult(
      operationRequestPath(getContainerWriterProjectionOperation, {
        containerId: projection().containerId,
      }),
      (value): value is unknown => value !== null,
      "GET",
      undefined,
      { reportErrors: false, signal: controller.signal },
      getContainerWriterProjectionOperation,
    );
    await citing.promise;
    controller.abort();
    expect(await within(pending, MANIFEST_CITATION_DEADLINE_MS / 2)).toEqual({
      settled: true,
      value: expect.objectContaining({ kind: "cancelled", ok: false }),
    });
    expect(hints).toEqual([]);
  },
);
