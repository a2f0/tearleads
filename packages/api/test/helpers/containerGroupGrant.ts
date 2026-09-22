import { db } from "@tearleads/api-shared/postgres";
import type { TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerAccessEventBody,
  VerifiedContainerKekState,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
} from "@tearleads/validators/request";
import invariant from "invariant";
import { routeApp } from "../../src/routeApp";
import {
  asVerifiedContainerManifest,
  createContainerManifestBundle,
  createSignedAccessEvent,
  loadPrincipalPoliciesForContainerPath,
  uniquePrincipalPolicies,
  userRecipientKeysFromKekTargets,
} from "./keyingWriterProjectionKit";
import { createGroupRequest } from "./organizationGroup";
import { joinOrg } from "./organizationMembership";
import { loadVerifiedPrincipalPolicy } from "./principalPolicy";
import {
  createManagedPrincipalWrap,
  principalHead,
  signGroupSuccessor,
  submitSuccessor,
} from "./rotatedReadGroupGrant";

export interface GrantableContainerFixture {
  readonly bundle: AccessManifestBundleWire;
  readonly kekState: VerifiedContainerKekState;
  readonly plaintextKek: Uint8Array;
}

async function buildContainerGroupGrantMutation(input: {
  readonly accessLevel: "read" | "write";
  readonly actor: TestUser;
  readonly container: GrantableContainerFixture;
  readonly parentKekState: VerifiedContainerKekState;
  readonly parentPath: readonly AccessManifestBundleWire[];
  readonly policy: VerifiedPrincipalPolicy;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.container.bundle);
  const previousContainerPath = [...input.parentPath, input.container.bundle];
  const reference = principalHead(input.policy);
  const grant = {
    accessLevel: input.accessLevel,
    subjectId: reference.principalId,
    subjectType: "group" as const,
  };
  const body: ContainerAccessEventBody = {
    containerKeyPublicKey: previous.state.containerKeyPublicKey,
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant,
    referencedPrincipalHead: reference,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [
      ...new Set(previousContainerPath.map((bundle) => bundle.manifestHash)),
    ],
    objectId: previous.state.containerId,
    objectKind: "container",
    organizationId: previous.state.organizationId,
    previousManifestHash: input.container.bundle.manifestHash,
    signer: input.actor,
  });
  const bundle = await createContainerManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.container.bundle.manifestHash,
      eventHash: event.eventHash,
      directGrants: [...previous.state.directGrants, grant],
      referencedPrincipalHeads: [
        ...previous.state.referencedPrincipalHeads,
        reference,
      ],
    },
    event,
  );
  const pathPolicies = await loadPrincipalPoliciesForContainerPath(
    previousContainerPath,
  );
  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.container.bundle,
    previousContainerPath,
    containerManifestHistory: [input.container.bundle],
    principalPolicies: uniquePrincipalPolicies([
      ...pathPolicies,
      input.policy,
    ]) as unknown as Record<string, unknown>[],
    keyEpoch: input.container.kekState.keyEpoch as unknown as Record<
      string,
      unknown
    >,
    keyring: null,
    predecessorBridge: null,
    wraps: [
      ...input.container.kekState.wraps,
      await createManagedPrincipalWrap({
        containerKey: input.container.plaintextKek,
        containerKeyEpochId: input.container.kekState.containerKeyEpochId,
        policy: input.policy,
        wrapManifestHash: bundle.manifestHash,
      }),
    ] as unknown as Record<string, unknown>[],
    parentKekState: input.parentKekState as unknown as Record<string, unknown>,
    userRecipientKeys: userRecipientKeysFromKekTargets(
      input.container.kekState,
    ) as unknown as Record<string, unknown>[],
  };
}

/**
 * Creates a read group (optionally seeded with `member`) and grants it on a
 * non-root container through the organization group policy commit. The
 * parent's KEK state and path come from the caller, as a client's do.
 */
export async function grantContainerThroughReadGroup(input: {
  readonly accessLevel?: "read" | "write";
  readonly actor: TestUser;
  readonly container: GrantableContainerFixture;
  readonly member?: TestUser | undefined;
  readonly parentKekState: VerifiedContainerKekState;
  readonly parentPath: readonly AccessManifestBundleWire[];
}): Promise<{ readonly groupId: string }> {
  const organizationId = asVerifiedContainerManifest(input.container.bundle)
    .state.organizationId;
  if (input.member) {
    await joinOrg(organizationId, input.actor, input.member);
  }
  const groupId = crypto.randomUUID();
  const createResponse = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.actor.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor: input.actor,
          additionalMembers: input.member ? [input.member] : [],
          groupId,
          name: "Child readers",
        }),
      ),
    },
  );
  invariant(createResponse.ok, await createResponse.clone().text());
  const initialPolicy = await loadVerifiedPrincipalPolicy(db, "group", groupId);
  const granted = await signGroupSuccessor({
    actor: input.actor,
    current: initialPolicy,
    grants: [
      {
        accessLevel: input.accessLevel ?? "read",
        containerId: input.container.kekState.containerId,
      },
    ],
  });
  await submitSuccessor({
    actor: input.actor,
    containerMutation: await buildContainerGroupGrantMutation({
      accessLevel: input.accessLevel ?? "read",
      actor: input.actor,
      container: input.container,
      parentKekState: input.parentKekState,
      parentPath: input.parentPath,
      policy: granted.policy,
    }),
    groupId,
    organizationId,
    successor: granted,
  });
  return { groupId };
}
