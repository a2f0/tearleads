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

function projectionWithSharedHistory(): ContainerWriterProjectionResponse {
  const projection = createContainerWriterProjectionResponse();
  const [kek] = projection.containerKeks;
  const [leaf] = projection.path;
  if (!kek || !leaf) throw new Error("fixture path missing");
  kek.containerManifestHistory = [leaf];
  return projection;
}

function serve(body: Parameters<typeof HttpResponse.json>[0]) {
  server.use(
    http.get(`${apiBaseUrl}/containers/:containerId/writer-projection`, () =>
      HttpResponse.json(body),
    ),
  );
}

testApiClient(
  "a served bundle is resolved into every position that cites its hash",
  async () => {
    const projection = projectionWithSharedHistory();
    const wire = encodeContainerWriterProjection(projection);
    expect(Object.keys(wire.bundles)).toHaveLength(1);
    serve(wire);
    const decoded = await new ApiClient(
      apiBaseUrl,
    ).getContainerWriterProjection(projection.containerId);
    expect(decoded).toEqual(projection);
    expect(decoded?.containerKeks[0]?.containerManifestHistory[0]).not.toBe(
      decoded?.path[0],
    );
  },
);

testApiClient(
  "an inconsistent bundle map is a shape failure, never a projection",
  async () => {
    const projection = projectionWithSharedHistory();
    const wire = encodeContainerWriterProjection(projection);
    const [hash] = Object.keys(wire.bundles);
    const bundle = hash ? wire.bundles[hash] : undefined;
    if (!hash || !bundle) throw new Error("fixture bundle missing");
    for (const body of [
      { ...wire, bundles: {} },
      { ...wire, bundles: { [hash]: { ...bundle, manifestHash: "other" } } },
      { ...wire, bundles: { ...wire.bundles, uncited: bundle } },
      // A decoded projection is not the served shape.
      projection,
    ]) {
      serve(body);
      expect(
        await new ApiClient(apiBaseUrl).getContainerWriterProjectionResult(
          projection.containerId,
          { reportErrors: false },
        ),
      ).toMatchObject({ kind: "shape", ok: false, status: 200 });
    }
  },
);
