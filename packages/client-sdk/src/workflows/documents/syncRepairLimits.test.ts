import { expect, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import type {
  AccessManifestBundleWireResponse,
  ContainerKekResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import { createMutationResponseFromRequest } from "../../../test/helpers/containerFixtures";
import { withStaleDocument } from "../../../test/helpers/syncRepairBoundary";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import {
  prepareAutomaticContainerRekeys,
  requireStandaloneAncestorRepairs,
} from "./syncContainerRekeyPreparation";

function replaceHead(
  projection: DocumentWriterProjectionResponse,
  containerId: string,
  head: AccessManifestBundleWireResponse,
  kek: ContainerKekResponse,
): DocumentWriterProjectionResponse {
  return {
    ...projection,
    authorizingContainerPaths: projection.authorizingContainerPaths.map(
      (path) => ({
        ...path,
        path: path.path.map((bundle, index) =>
          path.containerKeks[index]?.containerId === containerId
            ? head
            : bundle,
        ),
        containerKeks: path.containerKeks.map((previous, index) => {
          if (previous.containerId !== containerId) return previous;
          const previousHead = path.path[index];
          if (!previousHead) throw new Error("Expected previous head");
          return {
            ...kek,
            containerManifestHistory: [
              ...new Map(
                [
                  ...previous.containerManifestHistory,
                  previousHead,
                  ...kek.containerManifestHistory,
                ].map((bundle) => [bundle.manifestHash, bundle]),
              ).values(),
            ],
          };
        }),
      }),
    ),
  };
}

for (const reason of ["depth-budget", "peer-rotation"] as const) {
  test(`standalone repairs stop at ${reason} after acknowledging the first prefix`, async () => {
    await withStaleDocument(
      17,
      async ({ fixture, projection: initial, sync }) => {
        let projection = initial;
        let writes = 0;
        let refreshed = false;
        const apiClient = createMockApiClient({
          rekeyContainer: async (containerId, request) => {
            const previous =
              projection.authorizingContainerPaths[0]?.containerKeks.find(
                (kek) => kek.containerId === containerId,
              );
            if (!previous) throw new Error("Expected previous KEK");
            const response = await createMutationResponseFromRequest(
              request,
              previous,
            );
            projection = replaceHead(
              projection,
              containerId,
              response.accessManifest,
              response.containerKek,
            );
            writes += 1;
            return response;
          },
          getDocumentWriterProjectionResult: async () => {
            if (reason === "peer-rotation" && !refreshed) {
              const path = projection.authorizingContainerPaths[0];
              if (!path) throw new Error("Expected path");
              const rotated = await buildMaterializedContainerRekeyPlan({
                ...fixture.input,
                execSql: sync.execSql,
                previousProjection: {
                  ...path,
                  containerId: fixture.root.projection.containerId,
                  path: path.path.slice(0, 1),
                  containerKeks: path.containerKeks.slice(0, 1),
                },
              });
              const head = rotated.writerProjection.path[0];
              const kek = rotated.writerProjection.containerKeks[0];
              if (!head || !kek) throw new Error("Expected rotated root");
              projection = replaceHead(
                projection,
                fixture.root.projection.containerId,
                head,
                kek,
              );
            }
            refreshed = true;
            return { ok: true as const, data: projection };
          },
        });
        const attempt = { ...sync, apiClient };
        requireStandaloneAncestorRepairs(attempt);
        await expect(
          prepareAutomaticContainerRekeys(
            attempt,
            initial,
            reason === "depth-budget" ? 16 : undefined,
          ),
        ).rejects.toMatchObject({ reason });
        expect(refreshed).toBe(true);
        expect(writes).toBe(16);
      },
    );
  }, 120_000);
}
