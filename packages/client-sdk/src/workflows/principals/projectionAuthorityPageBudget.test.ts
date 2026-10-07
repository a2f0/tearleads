import { expect, test } from "bun:test";
import { principalPolicyMatchesReference } from "@tearleads/crypto";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { createPublicProjectionHistoryFixture } from "../../../test/helpers/publicProjectionHistory";
import { recoverProjectionPolicyHistory } from "./recoverProjectionPolicyHistory";

test("unrelated retained Admins references cannot overflow a group's authority page", async () => {
  const history = await signedAuthorityRecoveryHistory();
  const admin = await history.extend(history.admin, 140);
  const directory = await history.advanceDirectory(history.directory, admin);
  const fixture = await createPublicProjectionHistoryFixture(
    {
      ...history,
      admin,
      directory,
    },
    history.admin,
  );
  const references = [
    ...fixture.options.references,
    ...admin.previousStates.map(({ state }) => ({
      principalType: state.principalType,
      principalId: state.principalId,
      version: state.version,
      stateHash: state.stateHash,
      keyEpoch: state.keyEpoch,
      keyFingerprint: state.keyFingerprint,
    })),
  ];
  try {
    for (const offline of [false, true]) {
      const selections = await recoverProjectionPolicyHistory({
        ...fixture.options,
        references,
        offline,
      });
      expect(
        selections.some((policy) =>
          principalPolicyMatchesReference({
            policy,
            reference: principalPolicyHead(history.created),
          }),
        ),
      ).toBe(true);
      for (const reference of references)
        expect(
          selections.some((policy) =>
            principalPolicyMatchesReference({ policy, reference }),
          ),
        ).toBe(true);
    }
    const olderEvidence = structuredClone(fixture.options.evidence);
    olderEvidence.groups[0] = fixture.source(history.admin);
    olderEvidence.organizationPayloads = [
      {
        reference: principalPolicyHead(history.directory),
        payload: history.directory.currentPayload,
      },
    ];
    const historicalReferences = [
      principalPolicyHead(history.created),
      principalPolicyHead(history.admin),
    ];
    const beforeOffline = fixture.requests.length;
    const historical = await recoverProjectionPolicyHistory({
      ...fixture.options,
      evidence: olderEvidence,
      references: historicalReferences,
      offline: true,
    });
    expect(fixture.requests).toHaveLength(beforeOffline);
    for (const reference of historicalReferences)
      expect(
        historical.some((policy) =>
          principalPolicyMatchesReference({ policy, reference }),
        ),
      ).toBe(true);
  } finally {
    fixture.close();
  }
}, 30_000);
