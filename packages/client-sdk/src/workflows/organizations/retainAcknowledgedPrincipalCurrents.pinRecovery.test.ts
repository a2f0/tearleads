import { beforeAll, expect, test } from "bun:test";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import { advanceKeyingCheckpointsAtomically } from "../../data/persistence/keyingCheckpointAdvancePersistence";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import { principalHistoryPrefixes } from "../../data/sqlite/principalHistoryEvidenceSchema";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { PrincipalHistoryEvidenceUnavailableError } from "../principals/principalHistoryRecoveryReferences";
import { recoverScopedPrincipalPolicyHistory } from "../principals/recoverScopedPrincipalPolicyHistory";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

test.each([false, true])(
  "a pin-only receipt defers until scoped recovery proves its branch (fork=%s)",
  async (fork) => {
    const f = await currentPolicyPublicationFixture(history);
    const reader = await currentPolicyPublicationFixture(history);
    const incidents: unknown[] = [];
    const retain = () =>
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
      );
    try {
      const [group, organization] = f.publication.entries;
      if (!group || !organization) throw new Error("Missing fixture entries");
      const latest = await history.extend(
        fork ? history.directory : organization.response,
        68,
      );
      for (const fixture of [f, reader]) {
        fixture.policies.set(history.organizationId, latest);
        fixture.policies.set(
          history.group.currentState.principalId,
          group.response,
        );
      }
      // Verify on a separate connection, then admit only the evidence's pin.
      // The originating mutation's scoped prefix still ends at its predecessor.
      const evidence = await recoverScopedPrincipalPolicyHistory({
        ...reader.options,
        reference: principalPolicyHead(latest),
      });
      await advanceKeyingCheckpointsAtomically({
        execSql: f.options.execSql,
        organizationId: history.organizationId,
        access: [],
        policies: [...evidence.dependencies, evidence.policy],
      });
      const beforePrefixes = await f.db.select().from(principalHistoryPrefixes);
      const beforePins = await f.db.select().from(principalPolicyCheckpoints);
      await expect(retain()).rejects.toBeInstanceOf(
        PrincipalHistoryEvidenceUnavailableError,
      );
      expect(incidents).toHaveLength(0);
      expect(await f.db.select().from(principalHistoryPrefixes)).toEqual(
        beforePrefixes,
      );
      expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual(
        beforePins,
      );

      // A later scoped read supplies the missing ancestry; retry the same receipt.
      await recoverScopedPrincipalPolicyHistory({
        ...f.options,
        reference: principalPolicyHead(latest),
      });
      const recoveredPrefixes = await f.db
        .select()
        .from(principalHistoryPrefixes);
      if (fork) {
        await expect(retain()).rejects.toMatchObject({
          code: "object_mismatch",
        });
        expect(incidents).toHaveLength(1);
        expect(await f.db.select().from(principalHistoryPrefixes)).toEqual(
          recoveredPrefixes,
        );
        expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual(
          beforePins,
        );
      } else {
        expect((await retain()).map((policy) => policy.version)).toEqual([
          67, 67,
        ]);
        expect(incidents).toHaveLength(0);
      }
      expect(
        await loadPrincipalPolicyCheckpoint(
          f.options.execSql,
          "organization",
          history.organizationId,
        ),
      ).toMatchObject({
        version: 68,
        stateHash: latest.currentState.stateHash,
      });
    } finally {
      reader.close();
      f.close();
    }
  },
  30_000,
);
