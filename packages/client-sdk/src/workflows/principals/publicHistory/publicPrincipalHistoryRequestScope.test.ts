import { beforeAll, expect, test } from "bun:test";
import { createOrganizationHistoryFixture } from "../../../../test/helpers/data/organizationPolicyHistory";
import { createPublicHistoryFixture } from "../../../../test/helpers/data/publicPrincipalHistory";
import {
  createExpiringApiServer,
  SCOPE_RETIREMENTS,
} from "../../../../test/helpers/workflows/expiringApiServer";
import { isProjectionVerificationCancelledError } from "../../../data/keyingProjectionVerification";
import { principalHistoryPrefixes } from "../../../data/sqlite/schema/principalHistoryEvidenceSchema";
import { recoverPublicPrincipalHistory } from "./recoverPublicPrincipalHistory";

let history: Awaited<ReturnType<typeof createOrganizationHistoryFixture>>;
beforeAll(async () => {
  history = await createOrganizationHistoryFixture();
}, 30_000);

test.each(SCOPE_RETIREMENTS)(
  "a public principal-history page that expires after %s is not renewed or replayed",
  async (change) => {
    const f = await createPublicHistoryFixture({
      ...history,
      bundle: history.afterAddition,
    });
    const server = createExpiringApiServer({
      method: "GET",
      path: /^\/principals\/history$/,
    });
    let current = true;
    try {
      const recovering = recoverPublicPrincipalHistory({
        ...f.options,
        historyReader: server.api,
        organizationId: history.organizationId,
        stillCurrent: () => current,
      }).then(
        () => null,
        (error: unknown) => error,
      );
      await server.entered;
      current = false;
      server.retire(change);
      server.release();
      expect(isProjectionVerificationCancelledError(await recovering)).toBe(
        true,
      );
      expect(server.requests).toEqual(["GET /principals/history"]);
      expect(server.renewals.count).toBe(0);
      expect(await f.db.select().from(principalHistoryPrefixes)).toEqual([]);
    } finally {
      server.stop();
      f.close();
    }
  },
  15_000,
);
