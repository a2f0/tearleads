import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../../test/helpers/workflows/expiringApiServer";
import { withPrincipalPolicies } from "../../../../../test/helpers/workflows/principalPolicyServiceFixture";
import { sqlContainerContentsPersistence } from "../../../../data/persistence/container-contents/containerContentsPersistence";
import { containerContentsOrganizationHost } from "../../../organizations/containerContentsHost";
import type { RemoteContainer, RemoteContainerHydrationState } from "../types";
import { verifyRemoteContainerDestination } from "./verifiedDestination";

test.each(SCOPE_RETIREMENTS)(
  "a destination's projection read that expires after %s is not renewed or replayed",
  async (change) => {
    const listed: RemoteContainer = {
      createdAt: "2026-11-22T00:00:00.000Z",
      effectiveAccessLevel: "admin",
      id: crypto.randomUUID(),
      metadataAccessEpoch: 1,
      metadataAccessStateHash: "metadata-hash",
      metadataDocumentId: "listed-metadata",
      metadataReferencedPrincipals: [],
      metadataUpdateCount: 0,
      organizationId: crypto.randomUUID(),
      parentId: crypto.randomUUID(),
      systemSlot: null,
      updatedAt: "2026-11-22T00:00:00.000Z",
    };
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/containers/${listed.id}/writer-projection$`),
    });
    const { close, execSql } = await createTestExecSql(
      `destination-scope-${change}`,
    );
    let current = true;
    try {
      await sqlContainerContentsPersistence.ensureSchema(execSql);
      const state = {
        containersById: new Map(),
        persistence: sqlContainerContentsPersistence,
        runtime: withPrincipalPolicies({
          apiClient: server.api,
          infra: { execSql },
          organizations: containerContentsOrganizationHost,
          util: { log: () => {}, reportSecurityIncident: async () => {} },
        }),
      } as unknown as RemoteContainerHydrationState;
      const verified = verifyRemoteContainerDestination({
        heldBinding: null,
        isCurrent: () => current,
        remoteContainer: listed,
        state,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await verified).toBeNull();
      expect(server.requests).toEqual([
        `GET /containers/${listed.id}/writer-projection`,
      ]);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
      close();
    }
  },
  15_000,
);
