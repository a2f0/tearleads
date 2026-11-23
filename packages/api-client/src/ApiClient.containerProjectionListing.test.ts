import { expect } from "bun:test";
import {
  encodeContainerWriterProjection,
  type WriterProjectionListing,
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

testApiClient(
  "a listing read asks the citation source for that listing's held bytes",
  async () => {
    const projection = createContainerWriterProjectionResponse();
    server.use(
      http.get(`${apiBaseUrl}/containers/:containerId/writer-projection`, () =>
        HttpResponse.json(
          encodeContainerWriterProjection(projection, new Set()),
        ),
      ),
    );
    const cited: unknown[] = [];
    const citations: VerifiedManifestCitations = {
      cite: async (target) => {
        cited.push(target);
        return [];
      },
    };
    const client = new ApiClient(apiBaseUrl);
    client.setVerifiedManifestCitations(citations);
    const listing: WriterProjectionListing = {
      organizationId: projection.organizationId,
      parentId: "listed-parent",
    };

    expect(
      await client.getContainerWriterProjection(projection.containerId, {
        listing,
      }),
    ).toEqual(projection);
    expect(cited).toEqual([
      { id: projection.containerId, kind: "container", listing },
    ]);
  },
);
