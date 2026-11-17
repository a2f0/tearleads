import { beforeAll, expect, test } from "bun:test";
import { currentPolicyPublicationFixture } from "../../../../test/helpers/currentPolicyPublication";
import { principalPolicyHead } from "../../../../test/helpers/data/principalPolicyFixtures";
import { signedAuthorityRecoveryHistory } from "../../../../test/helpers/principalAuthorityRecovery";
import { KeyingCheckpointRepository } from "../../../data/persistence/keyingCheckpoints/keyingCheckpointRepository";
import { runWithSecurityIncidentReporting } from "../../../data/shared/securityIncidents";
import { principalHistoryPrefixes } from "../../../data/sqlite/schema/principalHistoryEvidenceSchema";
import { recoverScopedPrincipalPolicyHistory } from "../../principals/historyRecovery/recoverScopedPrincipalPolicyHistory";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

test.each([
  { version: 0, admit: false },
  { version: 67, admit: false },
  { version: 67, admit: true },
  { version: 68, admit: false },
  { version: 68, admit: true },
])(
  "honest acknowledgement after concurrent verified current recovery: %s",
  async ({ version, admit }) => {
    const f = await currentPolicyPublicationFixture(history);
    const incidents: unknown[] = [];
    try {
      const [group, organization] = f.publication.entries;
      if (!group || !organization) throw new Error("Missing fixture entries");
      // Publish the exact signed successors authored by this operation in the
      // test HTTP transport. Its current reply is delayed until after a reader.
      const latest =
        version > 67
          ? await history.extend(f.organizationBundle, version)
          : f.organizationBundle;
      f.policies.set(history.organizationId, latest);
      f.policies.set(history.group.currentState.principalId, f.response);
      if (version) {
        // A normal organization directory reader can observe the committed head
        // before the originating mutation receives/retains its acknowledgement.
        const recovered = await recoverScopedPrincipalPolicyHistory({
          ...f.options,
          reference: principalPolicyHead(latest),
        });
        expect(recovered.policy.version).toBe(version);
        if (admit)
          await new KeyingCheckpointRepository(
            f.options.execSql,
          ).advanceKeyingCheckpointsAtomically({
            organizationId: history.organizationId,
            access: [],
            policies: [...recovered.dependencies, recovered.policy],
          });
      }
      const outcome = runWithSecurityIncidentReporting(
        async (error) => {
          incidents.push(error);
        },
        {
          objectId: history.group.currentState.principalId,
          objectKind: "principal",
          operation: "group.member.add",
          organizationId: history.organizationId,
        },
        () => retainAcknowledgedPrincipalCurrents(f.publication),
      );
      expect((await outcome).map((policy) => policy.version)).toEqual([67, 67]);
      expect(incidents).toHaveLength(0);
      const prefixes = await f.db.select().from(principalHistoryPrefixes);
      expect(
        prefixes.find(
          (prefix) =>
            JSON.parse(prefix.headJson).principalId === history.organizationId,
        )?.version,
      ).toBe(Math.max(version, 67));
      expect(
        await new KeyingCheckpointRepository(
          f.options.execSql,
        ).loadPrincipalPolicyCheckpoint("organization", history.organizationId),
      ).toMatchObject({
        version: admit ? version : 67,
        stateHash: admit
          ? latest.currentState.stateHash
          : organization.response.head.stateHash,
      });
    } finally {
      f.close();
    }
  },
  30_000,
);
