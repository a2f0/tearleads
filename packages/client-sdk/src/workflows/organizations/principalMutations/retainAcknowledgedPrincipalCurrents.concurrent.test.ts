import { expect, test } from "bun:test";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import { currentPolicyPublicationFixture } from "../../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../../test/helpers/principalAuthorityRecovery";
import { principalHistoryPrefixes } from "../../../data/sqlite/schema/principalHistoryEvidenceSchema";
import { principalPolicyCheckpoints } from "../../../data/sqlite/schema/principalPolicySchema";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

test("overlapping identical acknowledgements both retain the same publication without regression", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await currentPolicyPublicationFixture(history);
  try {
    let prepared = 0;
    const restoredBoth = Promise.withResolvers<void>();
    const entries = f.publication.entries.map((entry) =>
      entry.request.state.principalType !== "group"
        ? entry
        : {
            ...entry,
            recovery: {
              ...entry.recovery,
              loadExternalAuthority: async (
                references: readonly ReferencedPrincipalHead[],
              ) => {
                // Authority preparation follows predecessor restoration and
                // identity verification. Pause both publications here, once
                // per operation, regardless of how many identities are read.
                const prefixes = await f.db
                  .select()
                  .from(principalHistoryPrefixes);
                expect(
                  prefixes.find(
                    (prefix) =>
                      JSON.parse(prefix.headJson).principalId ===
                      entry.request.state.principalId,
                  )?.version,
                ).toBe(entry.predecessor?.version);
                if (++prepared === 2) restoredBoth.resolve();
                await restoredBoth.promise;
                return entry.recovery.loadExternalAuthority?.(references);
              },
            },
          },
    );
    const results = await Promise.allSettled([
      retainAcknowledgedPrincipalCurrents({ ...f.publication, entries }),
      retainAcknowledgedPrincipalCurrents({ ...f.publication, entries }),
    ]);
    for (const result of results) {
      if (result.status !== "fulfilled") throw result.reason;
      expect(result.value.map((policy) => policy.version)).toEqual([67, 67]);
    }
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
