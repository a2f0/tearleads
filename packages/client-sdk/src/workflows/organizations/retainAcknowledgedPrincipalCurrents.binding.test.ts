import { beforeAll, expect, test } from "bun:test";
import {
  computePrincipalStatePayloadCiphertextHash,
  signPrincipalState,
} from "@tearleads/crypto";
import { currentPolicyPublicationFixture } from "../../../test/helpers/currentPolicyPublication";
import { signedAuthorityRecoveryHistory } from "../../../test/helpers/principalAuthorityRecovery";
import { policyBundleAfterMutation } from "../../../test/helpers/principalPolicyFixtures";
import { loadPrincipalPolicyCheckpoint } from "../../data/persistence/keyingCheckpointPersistence";
import {
  encodeOrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../../data/principals/organizationAuthorityDescriptor";
import { buildOrganizationGroupDirectoryPolicyRequest } from "./organizationGroupDirectory";
import { retainAcknowledgedPrincipalCurrents } from "./retainAcknowledgedPrincipalCurrents";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

test("a valid signed directory cannot substitute its payload organization", async () => {
  const f = await currentPolicyPublicationFixture(history);
  try {
    const entry = f.publication.entries[1];
    if (!entry) throw new Error("Missing directory receipt");
    const ciphertext = encodeOrganizationAuthorityDescriptor({
      ...parseOrganizationAuthorityDescriptor(
        entry.request.encryptedPayload.ciphertext,
      ),
      organizationId: "another-organization",
    });
    const ciphertextHash =
      await computePrincipalStatePayloadCiphertextHash(ciphertext);
    const request = {
      ...entry.request,
      encryptedPayload: {
        ...entry.request.encryptedPayload,
        ciphertext,
        ciphertextHash,
      },
      state: await signPrincipalState(
        { ...entry.request.state, payloadCiphertextHash: ciphertextHash },
        history.signingKeyPair.signingPrivateKey,
      ),
    };
    const response = await policyBundleAfterMutation({
      previous: history.directory,
      mutation: request,
    });
    await expect(
      retainAcknowledgedPrincipalCurrents({
        ...f.publication,
        entries: f.publication.entries.map((old) =>
          old === entry ? { ...entry, request, response } : old,
        ),
      }),
    ).rejects.toThrow(
      "Acknowledged organization does not bind its group receipt",
    );
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "organization",
        history.organizationId,
      ),
    ).toMatchObject({ version: 66 });
  } finally {
    f.close();
  }
});

test("group receipts require their acknowledged directory in the same batch", async () => {
  const f = await currentPolicyPublicationFixture(history);
  try {
    await expect(
      retainAcknowledgedPrincipalCurrents({
        ...f.publication,
        entries: f.publication.entries.slice(0, 1),
      }),
    ).rejects.toThrow(
      "Acknowledged groups require their organization directory",
    );
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        history.group.currentState.principalId,
      ),
    ).toMatchObject({ version: 66 });
  } finally {
    f.close();
  }
});

test("individually valid receipts cannot publish a group absent from the acknowledged directory", async () => {
  const f = await currentPolicyPublicationFixture(history);
  try {
    const orgEntry = f.publication.entries[1];
    const groupEntry = f.publication.entries[0];
    const signer = await history.resolveTrustedUserIdentity(
      history.signerUserId,
    );
    if (!orgEntry || !groupEntry || !signer)
      throw new Error("Missing publication fixture");
    const descriptor = parseOrganizationAuthorityDescriptor(
      history.directory.currentPayload.ciphertext,
    );
    // This valid directory successor still cites group version 66, not the
    // separately acknowledged group version 67 in the same local batch.
    const request = await buildOrganizationGroupDirectoryPolicyRequest({
      currentPolicy: history.directory,
      descriptor,
      groupHeads: descriptor.groupHeads,
      adminProjection: history.admin.currentProjection,
      adminUsers: [signer],
      signerUserId: history.signerUserId,
      signingFingerprint: signer.signingKeyFingerprint,
      signingKeyPair: history.signingKeyPair,
    });
    const response = await policyBundleAfterMutation({
      previous: history.directory,
      mutation: request,
    });
    await expect(
      retainAcknowledgedPrincipalCurrents({
        ...f.publication,
        entries: [groupEntry, { ...orgEntry, request, response }],
      }),
    ).rejects.toThrow(
      "Acknowledged organization does not bind its group receipt",
    );
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "group",
        history.group.currentState.principalId,
      ),
    ).toMatchObject({ version: 66 });
    expect(
      await loadPrincipalPolicyCheckpoint(
        f.options.execSql,
        "organization",
        history.organizationId,
      ),
    ).toMatchObject({ version: 66 });
  } finally {
    f.close();
  }
});
