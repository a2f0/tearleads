import { expect, test } from "bun:test";
import {
  generateSigningSeedAndKeyPair,
  organizationReplacementSigningBytes,
  sign,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { createOrganizationReplacementRecoveryHarness } from "../../../test/helpers/organizationReplacementRecoveryHarness";
import { organizationProvisioningAttempts } from "../../data/sqlite/organizationProvisioningAttemptSchema";
import {
  accessManifestCheckpoints,
  principalPolicyCheckpoints,
} from "../../data/sqlite/schema";

for (const attack of [
  "missing authorization",
  "wrong signing key",
  "different purged organization",
  "substituted organization",
  "substituted root",
  "altered principal genesis",
  "altered root genesis",
] as const) {
  test(`purge recovery preserves local data and pins after ${attack}`, async () => {
    const harness = await createOrganizationReplacementRecoveryHarness(
      ({ response, signingKeyPair }) => {
        const authorization = response.replacementAuthorization;
        if (!authorization)
          throw new Error("Expected signed replacement request");
        switch (attack) {
          case "missing authorization":
            return { ...response, replacementAuthorization: null };
          case "wrong signing key":
            return {
              ...response,
              replacementAuthorization: {
                ...authorization,
                signature: bytesToBase64(
                  sign(
                    organizationReplacementSigningBytes(authorization),
                    generateSigningSeedAndKeyPair().signingPrivateKey,
                  ),
                ),
              },
            };
          case "different purged organization": {
            const other = {
              ...authorization,
              replacesOrganizationId: crypto.randomUUID(),
            };
            return {
              ...response,
              replacementAuthorization: {
                ...other,
                signature: bytesToBase64(
                  sign(
                    organizationReplacementSigningBytes(other),
                    signingKeyPair.signingPrivateKey,
                  ),
                ),
              },
            };
          }
          case "substituted organization":
            return { ...response, organizationId: crypto.randomUUID() };
          case "substituted root":
            return { ...response, rootContainerId: crypto.randomUUID() };
          case "altered principal genesis":
            return {
              ...response,
              replacementAuthorization: {
                ...authorization,
                organizationStateHash: "e".repeat(64),
              },
            };
          case "altered root genesis":
            return {
              ...response,
              replacementAuthorization: {
                ...authorization,
                rootManifestHash: "e".repeat(64),
              },
            };
        }
      },
    );
    try {
      const before = await harness.protectedState();
      await expect(
        harness.session.recoverPurgedOrganization(harness.oldOrganizationId),
      ).rejects.toThrow();
      expect(await harness.protectedState()).toEqual(before);
      expect(harness.session.organizationId).toBe(harness.oldOrganizationId);
      expect(harness.session.containerId).toBe(harness.rootId);
      expect(harness.clearCount()).toBe(0);
      expect(harness.requests).toHaveLength(1);
      expect(
        await harness.db.select().from(organizationProvisioningAttempts),
      ).toHaveLength(1);
    } finally {
      harness.close();
    }
  });
}

test("missing proof leaves a durable replacement attempt that succeeds when evidence returns", async () => {
  let missingProof = true;
  const harness = await createOrganizationReplacementRecoveryHarness(
    ({ response }) =>
      missingProof ? { ...response, replacementAuthorization: null } : response,
  );
  try {
    await expect(
      harness.session.recoverPurgedOrganization(harness.oldOrganizationId),
    ).rejects.toThrow();
    const request = harness.requests[0];
    if (!request) throw new Error("Expected durable request");
    missingProof = false;
    const recovered = await harness.session.recoverPurgedOrganization(
      harness.oldOrganizationId,
    );
    expect(harness.requests[1]).toEqual(request);
    expect(recovered?.organizationId).toBe(request.organizationId);
    expect(harness.session.containerId).toBe(request.rootContainerId);
    expect(await harness.db.select().from(accessManifestCheckpoints)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          organizationId: harness.oldOrganizationId,
          objectId: harness.rootId,
          epoch: 2,
          manifestHash: "a".repeat(64),
        }),
      ]),
    );
    expect(await harness.db.select().from(principalPolicyCheckpoints)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: harness.oldOrganizationId,
          version: 2,
          stateHash: "b".repeat(64),
        }),
      ]),
    );
    expect(
      await harness.db.select().from(organizationProvisioningAttempts),
    ).toEqual([]);
  } finally {
    harness.close();
  }
});

for (const attack of ["missing proof", "substituted metadata"] as const) {
  test(`replacement finalization refuses ${attack} and retains its durable retry`, async () => {
    let tamper = true;
    const harness = await createOrganizationReplacementRecoveryHarness(
      ({ request, response }) => {
        if (!tamper || !request.finalizeReplacement) return response;
        return attack === "missing proof"
          ? { ...response, replacementAuthorization: null }
          : { ...response, rootMetadataDocumentId: crypto.randomUUID() };
      },
    );
    try {
      await expect(
        harness.session.recoverPurgedOrganization(harness.oldOrganizationId),
      ).rejects.toThrow();
      expect(harness.session.organizationId).toBe(harness.oldOrganizationId);
      expect(harness.clearCount()).toBe(0);
      expect(
        await harness.db.select().from(organizationProvisioningAttempts),
      ).toHaveLength(1);
      // Reset already committed after the valid first response. A failed final
      // acknowledgment must retain the same authorized destination for retry.
      const winner = harness.requests[0];
      if (!winner) throw new Error("Expected replacement candidate");
      tamper = false;
      const result = await harness.session.recoverPurgedOrganization(
        harness.oldOrganizationId,
      );
      expect(result?.organizationId).toBe(winner.organizationId);
      expect(harness.session.containerId).toBe(winner.rootContainerId);
      expect(
        await harness.db.select().from(organizationProvisioningAttempts),
      ).toEqual([]);
    } finally {
      harness.close();
    }
  });
}
