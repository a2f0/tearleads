import { expect, test } from "bun:test";
import { restorePrincipalPolicyHistoryVerifier } from "@tearleads/crypto";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import {
  loadPrincipalHistoryPrefix,
  savePrincipalHistoryPrefix,
} from "../../data/persistence/principalHistoryPrefixPersistence";
import {
  principalHistoryEvidenceScopeId,
  principalHistoryPrefixProtection,
} from "../../data/principals/principalHistoryPrefixProtection";
import { principalHistoryPrefixes } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalHistoryVerificationContext } from "../principals/principalHistoryRecoveryVerification";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

test("an identical completed recovery cannot invalidate a pending acknowledgement", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const f = await currentPolicyPublicationFixture(history);
  let resealed = false;
  try {
    const entries = f.publication.entries.map((entry, index) =>
      index !== 0
        ? entry
        : {
            ...entry,
            recovery: {
              ...entry.recovery,
              loadExternalAuthority: async () => {
                // The acknowledgement has restored its predecessor. Model a
                // concurrent reader finishing that same authenticated history.
                const options = f.groupRecovery;
                const protection = {
                  ...options.protection,
                  context: principalHistoryVerificationContext(options),
                };
                const scopeId = await principalHistoryEvidenceScopeId({
                  organizationId: history.organizationId,
                  head: options.expectedHead,
                  protection,
                });
                const saved = await loadPrincipalHistoryPrefix(
                  f.options.execSql,
                  scopeId,
                );
                if (!saved) throw new Error("Missing predecessor prefix");
                const seal = await principalHistoryPrefixProtection(
                  protection,
                  saved,
                );
                const restored = await restorePrincipalPolicyHistoryVerifier(
                  {
                    principalId: options.expectedHead.principalId,
                    principalType: options.expectedHead.principalType,
                  },
                  saved.progress,
                  seal,
                );
                if (!restored.ok) throw restored.error;
                const verified = restored.value.finish(options.expectedHead);
                if (!verified.ok) throw verified.error;
                const progress = await restored.value.exportProgress(seal);
                if (!progress.ok) throw progress.error;
                expect(progress.value).not.toBe(saved.progress);
                await savePrincipalHistoryPrefix({
                  execSql: f.options.execSql,
                  prefix: { ...saved, progress: progress.value },
                  indexRootHash: verified.value.indexRootHash,
                  stillCurrent: () => f.lifetime.current,
                });
                resealed = true;
                return f.input.externalAuthority;
              },
            },
          },
    );
    const policies = await retainAcknowledgedPrincipalCurrents({
      ...f.publication,
      entries,
    });
    expect(resealed).toBe(true);
    expect(policies.map((policy) => policy.version)).toEqual([67, 67]);
    const prefixes = await f.db.select().from(principalHistoryPrefixes);
    for (const entry of entries)
      expect(
        prefixes.find(
          (prefix) =>
            JSON.parse(prefix.headJson).principalId ===
            entry.request.state.principalId,
        )?.version,
      ).toBe(67);
  } finally {
    f.close();
  }
}, 15_000);
