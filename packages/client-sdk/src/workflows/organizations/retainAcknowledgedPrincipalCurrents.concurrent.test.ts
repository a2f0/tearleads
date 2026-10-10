import { expect, test } from "bun:test";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { principalHistoryPrefixes } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

test("overlapping identical acknowledgements both retain the same publication without regression", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await currentPolicyPublicationFixture(history);
  try {
    let prepared = 0;
    const restoredBoth = Promise.withResolvers<void>();
    const entries = f.publication.entries.map((entry) =>
      entry.request.state.principalType !== "organization"
        ? entry
        : {
            ...entry,
            recovery: {
              ...entry.recovery,
              resolveTrustedUserIdentity: async (userId: string) => {
                // Identity lookup happens after restoring the last predecessor.
                // Hold both writers here so neither observes a newer prefix.
                if (++prepared === 2) restoredBoth.resolve();
                await restoredBoth.promise;
                return history.resolveTrustedUserIdentity(userId);
              },
            },
          },
    );
    const results = await Promise.allSettled([
      retainAcknowledgedPrincipalCurrents({ ...f.publication, entries }),
      retainAcknowledgedPrincipalCurrents({ ...f.publication, entries }),
    ]);
    expect(prepared).toBe(2);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    const prefixes = await f.db.select().from(principalHistoryPrefixes);
    for (const entry of entries) {
      const principalId = entry.request.state.principalId;
      expect(
        prefixes.find(
          (prefix) => JSON.parse(prefix.headJson).principalId === principalId,
        )?.version,
      ).toBe(67);
      expect(
        (await f.db.select().from(principalPolicyCheckpoints)).find(
          (checkpoint) => checkpoint.principalId === principalId,
        )?.version,
      ).toBe(67);
    }
  } finally {
    f.close();
  }
}, 15_000);
