import { expect, test } from "bun:test";
import {
  createRecoveryFixture,
  signedRecoveryHistory,
} from "../../../test/helpers/principalHistoryRecovery";
import { createPrincipalHistoryProtectionCustody } from "../../client/principalHistoryProtection";
import {
  principalHistoryEntries,
  principalHistoryNodes,
  principalHistoryPrefixes,
} from "../../data/sqlite/principalHistoryEvidenceSchema";
import { recoverPrincipalPolicyHistory } from "./recoverPrincipalPolicyHistory";

test("headless restarts reverify history without multiplying evidence rows", async () => {
  const history = await signedRecoveryHistory(34);
  const f = await createRecoveryFixture(history);
  const scope = {
    database: {},
    generation: 1,
    identityTrustDomain: "api",
    signingFingerprint: "signer",
  };
  const counts = async () =>
    Promise.all([
      f.db
        .select()
        .from(principalHistoryEntries)
        .then((rows) => rows.length),
      f.db
        .select()
        .from(principalHistoryNodes)
        .then((rows) => rows.length),
      f.db
        .select()
        .from(principalHistoryPrefixes)
        .then((rows) => rows.length),
    ]);
  let firstCounts: Awaited<ReturnType<typeof counts>> | undefined;
  try {
    for (let restart = 0; restart < 3; restart += 1) {
      const custody = createPrincipalHistoryProtectionCustody({
        readScope: () => scope,
      });
      const lease = custody.bind();
      if (!lease) throw new Error("Missing headless lease");
      f.requests.length = 0;
      await lease(async ({ protection, stillCurrent }) => {
        const options = { ...f.options, protection, stillCurrent };
        if (restart > 0) {
          await expect(
            recoverPrincipalPolicyHistory({ ...options, offline: true }),
          ).rejects.toMatchObject({ code: "missing_dependency" });
          expect(f.requests).toEqual([]);
        }
        expect(
          (await recoverPrincipalPolicyHistory(options)).policy.stateHash,
        ).toBe(history.expectedHead.stateHash);
      });
      expect(f.requests).toEqual([0, 32]);
      firstCounts ??= await counts();
      expect(await counts()).toEqual(firstCounts);
      custody.retire();
    }
  } finally {
    f.close();
  }
}, 20_000);
