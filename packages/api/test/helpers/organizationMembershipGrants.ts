import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import type { TestUser } from "@tearleads/bob-and-alice";
import type {
  ContainerKeyEpoch,
  ContainerKeyWrap,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computePrincipalStateHash,
  makeVerifiedPrincipalPolicy,
  normalizeContainerKekKeyring,
  openContainerKekKeyring,
  verifyContainerKekState,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type {
  AccessManifestBundleWire,
  ContainerMutationRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import { isContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { routeApp } from "../../src/routeApp";
import { buildPrincipalGrantRefreshRequest } from "./containerGrantRefresh";
import {
  asVerifiedContainerManifest,
  loadPrincipalPoliciesForContainerPaths,
} from "./containerMutationRotations";
import { buildRootContainerRekeyMutation } from "./containerRekey";
import { loadVerifiedPrincipalPolicy } from "./principalPolicy";
import { recoverRegisteredRootKek } from "./registeredRootKek";

async function loadDecryptableGroupRoot(input: {
  actor: TestUser;
  containerId: string;
}) {
  const response = await routeApp.request(
    `/containers/${input.containerId}/writer-projection`,
    { headers: { Authorization: `Bearer ${input.actor.token}` } },
  );
  invariant(response.ok, await response.clone().text());
  const projection: unknown = await response.json();
  invariant(
    isContainerWriterProjectionResponse(projection),
    "expected a container writer projection",
  );
  invariant(projection.path.length === 1, "expected a group-owned root");
  const bundle = projection.path[0] as AccessManifestBundleWire;
  const containerKek = projection.containerKeks[0];
  invariant(containerKek, "expected the root container key epoch");
  const principalPolicies = await loadPrincipalPoliciesForContainerPaths([
    [bundle],
  ]);
  const verified = await verifyContainerKekState({
    containerManifest: asVerifiedContainerManifest(bundle),
    keyEpoch: containerKek.keyEpoch as unknown as ContainerKeyEpoch,
    principalPolicies,
    userRecipientKeys: (containerKek.wraps as unknown as ContainerKeyWrap[])
      .filter((wrap) => wrap.recipientKind === "user")
      .map((wrap) => ({
        userId: wrap.recipientId,
        recipientKeyEpochId: wrap.recipientKeyEpochId,
        recipientKeyFingerprint: wrap.recipientKeyFingerprint,
      })),
    wraps: containerKek.wraps as unknown as ContainerKeyWrap[],
  });
  if (!verified.ok) throw verified.error;
  const root = await recoverRegisteredRootKek({
    owner: input.actor,
    root: {
      bundle,
      principalPolicies,
      kekState: verified.value,
    },
  });
  return {
    ...root,
    keyringEntries: containerKek.keyring
      ? await openContainerKekKeyring({
          keyEpoch: containerKek.containerKeyEpoch,
          keyring: normalizeContainerKekKeyring(containerKek.keyring),
          successorContainerKey: root.plaintextKek,
        })
      : [],
  };
}

async function wrapContainerMutationKey(input: {
  request: ContainerMutationRequest;
  plaintextKek: Uint8Array;
  nextPolicy: VerifiedPrincipalPolicy;
  retainedWraps?: readonly ContainerKeyWrap[] | undefined;
}): Promise<void> {
  input.request.wraps = await Promise.all(
    input.request.wraps.map(async (record) => {
      const target = record as unknown as ContainerKeyWrap;
      const retained = input.retainedWraps?.find(
        (wrap) =>
          wrap.containerKeyEpochId === target.containerKeyEpochId &&
          wrap.recipientKind === target.recipientKind &&
          wrap.recipientId === target.recipientId &&
          wrap.recipientKeyEpochId === target.recipientKeyEpochId &&
          wrap.recipientKeyFingerprint === target.recipientKeyFingerprint,
      );
      if (retained) return { ...retained };
      let publicKey: string;
      if (target.recipientKind === "user") {
        const [recipient] = await db
          .select({ publicKey: users.encapsulationPublicKey })
          .from(users)
          .where(eq(users.id, target.recipientId))
          .limit(1);
        invariant(recipient, "expected a direct user recipient");
        publicKey = recipient.publicKey;
      } else {
        invariant(
          target.recipientKind === "group",
          "expected a root key recipient",
        );
        const policy =
          target.recipientId === input.nextPolicy.principalId
            ? input.nextPolicy
            : await loadVerifiedPrincipalPolicy(
                db,
                "group",
                target.recipientId,
              );
        publicKey = policy.state.encapsulationPublicKey;
      }
      const [wrapped] = await wrapDekForRecipients(input.plaintextKek, [
        base64ToBytes(publicKey),
      ]);
      invariant(wrapped, "expected a wrapped root container key");
      return {
        ...target,
        kemCipherText: bytesToBase64(wrapped.kemCipherText),
        wrappedKey: bytesToBase64(wrapped.wrappedKey),
      };
    }),
  );
}

/** Preserve grants while refreshing or rotating affected roots and their keys. */
export async function buildGroupMembershipContainerMutations(input: {
  actor: TestUser;
  containerIds?: readonly string[] | undefined;
  currentPolicy?: VerifiedPrincipalPolicy | undefined;
  nextPolicy: VerifiedPrincipalPolicy;
}): Promise<ContainerMutationRequest[]> {
  const currentPolicy =
    input.currentPolicy ??
    (await loadVerifiedPrincipalPolicy(
      db,
      "group",
      input.nextPolicy.principalId,
    ));
  const requests: ContainerMutationRequest[] = [];
  for (const grant of input.nextPolicy.grants) {
    if (input.containerIds && !input.containerIds.includes(grant.containerId))
      continue;
    const root = await loadDecryptableGroupRoot({
      actor: input.actor,
      containerId: grant.containerId,
    });
    const mutation =
      input.nextPolicy.keyEpoch === currentPolicy.keyEpoch
        ? {
            plaintextKek: root.plaintextKek,
            request: await buildPrincipalGrantRefreshRequest({
              parentKekState: null,
              previous: root.bundle,
              previousContainerPath: [root.bundle],
              previousKekState: root.kekState,
              replacementPrincipalPolicy: input.nextPolicy,
              signer: input.actor,
            }),
          }
        : await buildRootContainerRekeyMutation({
            previous: root,
            replacementPrincipalPolicy: input.nextPolicy,
            signer: input.actor,
          });
    await wrapContainerMutationKey({
      request: mutation.request,
      plaintextKek: mutation.plaintextKek,
      nextPolicy: input.nextPolicy,
      retainedWraps:
        input.nextPolicy.keyEpoch === currentPolicy.keyEpoch
          ? root.kekState.wraps
          : undefined,
    });
    requests.push(mutation.request);
  }
  return requests;
}

/** Pair a signed membership successor with every dependent container rekey. */
export async function withGroupMembershipContainerMutations(input: {
  actor: TestUser;
  containerIds?: readonly string[] | undefined;
  currentPolicy: VerifiedPrincipalPolicy;
  signedState: PutPrincipalPolicyRequest;
}): Promise<PutPrincipalPolicyRequest> {
  const { currentPolicy, signedState } = input;
  const stateHash = await computePrincipalStateHash(signedState.state);
  const nextState = {
    ...signedState.state,
    stateHash,
    createdAt: signedState.state.signedAt,
  };
  const nextPolicy = makeVerifiedPrincipalPolicy({
    principalType: nextState.principalType,
    principalId: nextState.principalId,
    version: nextState.version,
    keyEpoch: nextState.keyEpoch,
    stateHash,
    state: nextState,
    projection: signedState.projection,
    grants: signedState.grants,
    history: [
      ...(currentPolicy.history ?? []),
      {
        state: nextState,
        projection: signedState.projection,
        grants: signedState.grants,
      },
    ],
    checkpoint: {
      principalType: nextState.principalType,
      principalId: nextState.principalId,
      version: nextState.version,
      stateHash,
    },
  });
  return {
    ...signedState,
    containerMutations: await buildGroupMembershipContainerMutations({
      actor: input.actor,
      containerIds: input.containerIds,
      currentPolicy,
      nextPolicy,
    }),
  };
}
