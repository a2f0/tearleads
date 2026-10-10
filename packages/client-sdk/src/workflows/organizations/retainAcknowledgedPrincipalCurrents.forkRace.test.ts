import { beforeAll, expect, test } from "bun:test";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { principalHistoryPrefixes } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { recoverScopedPrincipalPolicyHistory } from "../principals/recoverScopedPrincipalPolicyHistory";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

test.each([67, 68])(
  "a verified reader on a conflicting branch at version %s cannot admit a delayed receipt",
  async (version) => {
    const f = await currentPolicyPublicationFixture(history);
    try {
      const fork = await history.extend(history.directory, version);
      f.policies.set(history.organizationId, fork);
      const recovered = await recoverScopedPrincipalPolicyHistory({
        ...f.options,
        reference: principalPolicyHead(fork),
      });
      await advanceKeyingCheckpointsAtomically({
        execSql: f.options.execSql,
        organizationId: history.organizationId,
        access: [],
        policies: [...recovered.dependencies, recovered.policy],
      });
      const prefixes = await f.db.select().from(principalHistoryPrefixes);
      const pins = await f.db.select().from(principalPolicyCheckpoints);
      const incidents: unknown[] = [];
      await expect(
        runWithSecurityIncidentReporting(
          async (error) => {
            incidents.push(error);
          },
          {
            objectId: history.organizationId,
            objectKind: "principal",
            operation: "group.member.add",
            organizationId: history.organizationId,
          },
          () => retainAcknowledgedPrincipalCurrents(f.publication),
        ),
      ).rejects.toMatchObject({ code: "object_mismatch" });
      expect(incidents).toHaveLength(1);
      expect(await f.db.select().from(principalHistoryPrefixes)).toEqual(
        prefixes,
      );
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual(
        pins,
      );
    } finally {
      f.close();
    }
  },
  15_000,
);
