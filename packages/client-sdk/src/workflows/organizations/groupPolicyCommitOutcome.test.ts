import { expect, test } from "bun:test";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { buildInitialGroupPolicyRequest } from "../../../test/helpers/groupMetadata";
import {
  policyBundleFromInitialRequest,
  principalPolicyHead,
} from "../../../test/helpers/principalPolicyFixtures";
import { commitGroupPolicyMutation } from "./groupPolicyMutationContext";

for (const kind of ["cancelled", "outcome-unknown"] as const) {
  test(`policy submission preserves ${kind} without reporting or retrying it`, async () => {
    const signingKeyPair = generateSigningSeedAndKeyPair();
    const request = await buildInitialGroupPolicyRequest({
      creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
      groupId: crypto.randomUUID(),
      name: "Operators",
      signerUserId: crypto.randomUUID(),
      signingFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
      signingKeyPair,
    });
    const bundle = await policyBundleFromInitialRequest(request);
    let submissions = 0;
    let reports = 0;
    const message =
      "Policy request may have committed; refresh before retrying";
    await expect(
      commitGroupPolicyMutation({
        apiClient: {
          getCurrentPrincipalPolicy: async () => bundle,
          commitOrganizationGroupPolicy: async () => {
            throw new Error("Expected status-bearing submission");
          },
          commitOrganizationGroupPolicyResult: async () => {
            submissions += 1;
            return {
              ok: false,
              kind,
              message,
              status: null,
              report: () => {
                reports += 1;
              },
            };
          },
        },
        currentPolicy: bundle,
        organizationPolicy: bundle,
        expectedHead: principalPolicyHead(bundle),
        groupId: request.groupId,
        organizationId: crypto.randomUUID(),
        request: request.initialGroupPolicy,
        organizationRequest: request.initialGroupPolicy,
        execSql: async () => {
          throw new Error("An unacknowledged submission cannot persist");
        },
      }),
    ).rejects.toThrow(
      kind === "outcome-unknown" ? message : "Group policy update failed",
    );
    expect(submissions).toBe(1);
    expect(reports).toBe(0);
  });
}
