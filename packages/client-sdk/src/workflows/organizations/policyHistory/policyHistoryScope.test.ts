import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { organizationReadModelSnapshot } from "../../../../test/helpers/data/organizationReadModelProjectionFixtures";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { createOrganizationHistoryPageFixture } from "../../../../test/helpers/workflows/organizationHistoryPage";
import { OrganizationReadModelRepository } from "../../../data/persistence/organizations/organizationReadModelRepository";
import { PrincipalPolicyBundleRepository } from "../../../data/persistence/principalPolicy/principalPolicyBundleRepository";
import { createDomainScope } from "../../../data/shared/domainScope";
import { loadPolicyHistoryDetails } from "./loadPolicyHistoryDetails";
import { buildOrganizationPolicyHistory } from "./policyHistoryReadModel";

test.each(SCOPE_RETIREMENTS)(
  "a policy-history page that expires after %s is not renewed or replayed",
  async (change) => {
    const fixture = await createOrganizationHistoryPageFixture();
    const { data } = fixture;
    const sql = await createTestExecSql(`policy-history-scope-${change}`);
    const server = createExpiringApiServer({
      method: "GET",
      path: new RegExp(`^/organizations/${data.organizationId}/`),
    });
    let current = true;
    try {
      const common = {
        currentUserId: data.signerUserId,
        execSql: sql.execSql,
        organizationId: data.organizationId,
      };
      const snapshot = organizationReadModelSnapshot(common);
      snapshot.lanes.organizationPolicy.currentState =
        data.afterAddition.currentState;
      await new OrganizationReadModelRepository(
        sql.execSql,
      ).applyOrganizationReadModelResponse({
        ...common,
        requestedCursor: null,
        response: snapshot,
      });
      await new PrincipalPolicyBundleRepository(
        sql.execSql,
      ).savePrincipalPolicyBundle(data.afterAddition, data.organizationId);
      const loaded = loadPolicyHistoryDetails({
        ...common,
        ...fixture.input,
        apiClient: server.api,
        domainScope: createDomainScope(),
        history: buildOrganizationPolicyHistory(data.afterAddition),
        logError: () => {},
        olderPage: true,
        online: true,
        stillCurrent: () => current,
      });
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(await loaded).toBeNull();
      expect(server.requests).toHaveLength(1);
      expect(server.renewals.count).toBe(0);
    } finally {
      server.stop();
      sql.close();
      fixture.close();
    }
  },
  15_000,
);
