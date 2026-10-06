import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import { computePrincipalStateHash } from "@tearleads/crypto";
import { isContainerMutationResponse } from "@tearleads/validators/response";
import { buildRootGrantRequest } from "../../../test/helpers/containerGrantMutation";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  bootstrapRoot,
  createContainerManifestBundle,
  createSignedAccessEvent,
  kekStateFromContainerResponse,
  loadPrincipalPoliciesForContainerPath,
  userRecipientKeysFromKekTargets,
} from "../../../test/helpers/keyingWriterProjectionKit";
import {
  runGetCurrentPrincipalPolicyWorkflow,
  submitOrganizationGroupPolicyCommit,
} from "../../../test/helpers/principalPolicy";
import { registerAndAuthenticate } from "../../../test/helpers/principalPolicyReadFixtures";
import { signPrincipalStateBundle } from "../../../test/helpers/principalState";
import { recoverRegisteredRootKek } from "../../../test/helpers/registeredRootKek";
import {
  createManagedPrincipalWrap,
  grantRootThroughRotatedReadGroup,
} from "../../../test/helpers/rotatedReadGroupGrant";
import { routeApp } from "../../routeApp";

test("writer projections retain the old principal citation of an unchanged key wrap", async () => {
  const owner = createTestUser();
  const reader = createTestUser();
  await registerAndAuthenticate(owner, reader);
  const initialRoot = await recoverRegisteredRootKek({
    owner,
    root: await bootstrapRoot(owner),
  });
  const granted = await grantRootThroughRotatedReadGroup({
    actor: owner,
    reader,
    root: initialRoot,
  });
  const directShare = await routeApp.request(
    `/containers/${granted.root.kekState.containerId}/share`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await buildRootGrantRequest({
          previous: granted.root.bundle,
          previousKekState: granted.root.kekState,
          signer: owner,
          recipient: reader,
        }),
      ),
    },
  );
  expect(directShare.status, await directShare.clone().text()).toBe(200);
  const shared: unknown = await directShare.json();
  if (!isContainerMutationResponse(shared))
    throw new Error("Missing shared root");
  const root = {
    ...granted.root,
    bundle: accessManifestFromContainerResponse(shared),
    kekState: kekStateFromContainerResponse(shared),
  };
  const previous = asVerifiedContainerManifest(root.bundle);
  const reference = previous.state.referencedPrincipalHeads.find(
    (head) => head.principalId === granted.groupId,
  );
  if (reference?.principalType !== "group")
    throw new Error("Missing root group");
  const policy = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "group",
    reference.principalId,
  );
  const signed = await signPrincipalStateBundle({
    ...policy.currentState,
    version: policy.currentState.version + 1,
    prevStateHash: policy.currentState.stateHash,
    signedAt: new Date(
      Date.parse(policy.currentState.signedAt) + 1_000,
    ).toISOString(),
    members: policy.currentProjection.map(({ userId }) => ({ userId })),
    projection: policy.currentProjection,
    grants: policy.currentGrants,
    memberEnvelopes: policy.currentMemberEnvelopes.envelopes,
    payloadCiphertext: policy.currentPayload.ciphertext,
    signingPrivateKey: owner.signing.signingPrivateKey,
  });
  const nextReference = {
    ...reference,
    version: signed.state.version,
    stateHash: await computePrincipalStateHash(signed.state),
  };
  expect(nextReference.keyEpoch).toBe(reference.keyEpoch);
  const grant = previous.state.directGrants.find(
    (grant) => grant.subjectId === reference.principalId,
  );
  if (!grant) throw new Error("Missing principal grant");
  const body = {
    eventType: "container.grant" as const,
    containerKeyEpochId: previous.state.containerKeyEpochId,
    containerKeyPublicKey: previous.state.containerKeyPublicKey,
    grant,
    referencedPrincipalHead: nextReference,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [previous.manifestHash],
    objectKind: "container",
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: owner,
  });
  const manifest = await createContainerManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: previous.manifestHash,
      eventHash: event.eventHash,
      referencedPrincipalHeads: previous.state.referencedPrincipalHeads.map(
        (head) =>
          head.principalId === reference.principalId ? nextReference : head,
      ),
    },
    event,
  );
  const policies = await loadPrincipalPoliciesForContainerPath([root.bundle]);
  const nextState = {
    ...signed.state,
    stateHash: nextReference.stateHash,
    createdAt: signed.state.signedAt,
  };
  const nextPolicies = policies.map((policy) =>
    policy.principalId !== reference.principalId
      ? policy
      : {
          ...policy,
          version: nextReference.version,
          stateHash: nextReference.stateHash,
          state: nextState,
          projection: signed.projection,
          grants: signed.grants,
          history: [
            ...(policy.history ?? []),
            {
              state: nextState,
              projection: signed.projection,
              grants: signed.grants,
            },
          ],
          checkpoint: {
            ...policy.checkpoint,
            version: nextReference.version,
            stateHash: nextReference.stateHash,
          },
        },
  );
  const nextPolicy = nextPolicies.find(
    (policy) => policy.principalId === reference.principalId,
  );
  if (!nextPolicy) throw new Error("Missing successor policy");
  const newWrap = await createManagedPrincipalWrap({
    containerKey: root.plaintextKek,
    containerKeyEpochId: root.kekState.containerKeyEpochId,
    policy: nextPolicy,
    wrapManifestHash: manifest.manifestHash,
  });
  const refreshed = await submitOrganizationGroupPolicyCommit({
    actor: owner,
    groupId: reference.principalId,
    organizationId: previous.state.organizationId,
    groupPolicy: {
      ...signed,
      containerMutations: [
        {
          body,
          event: { ...event.event },
          expectedManifestHash: manifest.manifestHash,
          manifest: manifest.manifest,
          previousManifest: root.bundle,
          previousContainerPath: [root.bundle],
          containerManifestHistory: [
            root.bundle,
            granted.root.bundle,
            initialRoot.bundle,
          ],
          principalPolicies: nextPolicies.map((policy) => ({ ...policy })),
          keyEpoch: { ...root.kekState.keyEpoch },
          keyring: null,
          predecessorBridge: null,
          wraps: [
            ...root.kekState.wraps.filter(
              (wrap) => wrap.recipientId !== reference.principalId,
            ),
            newWrap,
          ].map((wrap) => ({ ...wrap })),
          parentKekState: null,
          userRecipientKeys: userRecipientKeysFromKekTargets(root.kekState).map(
            (key) => ({ ...key }),
          ),
        },
      ],
    },
  });
  expect(refreshed.status, await refreshed.clone().text()).toBe(200);
  const response = await routeApp.request(
    `/containers/${previous.state.containerId}/writer-projection`,
    {
      headers: { Authorization: `Bearer ${owner.token}` },
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
}, 15_000);
