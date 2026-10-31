import {
  type AccessEvent,
  type AccessManifest,
  accessManifestCheckpointFromManifest,
  type ContainerAccessManifestState,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  compareCanonicalStrings,
  computeContainerKekKeyringHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
} from "@tearleads/crypto";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { canonicalKeyingJsonString } from "../../keying/canonicalJson";
import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  type LocallyAcknowledgedAccessManifestHead,
} from "../../persistence/keyingCheckpoints/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../sqlite/sqlSchema";

export interface AuthoredContainerMutationHead {
  readonly body: object;
  readonly containerId: string;
  readonly event: AccessEvent;
  readonly eventHash: string;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  /**
   * The keyring the epoch already had, for mutations that keep their epoch.
   * Its artifact is immutable, so the acknowledged keyring hash must be its.
   */
  readonly previousKeyring?: Record<string, unknown> | null | undefined;
  readonly state: ContainerAccessManifestState;
  readonly wraps: readonly ContainerKeyWrap[];
}

function expectedRecipientTargets(
  wraps: readonly ContainerKeyWrap[],
): ContainerKekRecipientTarget[] {
  return [
    ...wraps.map((wrap) => ({
      recipientId: wrap.recipientId,
      recipientKeyEpochId: wrap.recipientKeyEpochId,
      recipientKeyFingerprint: wrap.recipientKeyFingerprint,
      recipientKind: wrap.recipientKind,
    })),
  ].sort((left, right) =>
    compareCanonicalStrings(
      canonicalKeyingJsonString(left, "recipient target"),
      canonicalKeyingJsonString(right, "recipient target"),
    ),
  );
}

function assertResponseIdentity(
  plan: AuthoredContainerMutationHead,
  response: ContainerMutationResponse,
): void {
  if (
    response.containerId !== plan.containerId ||
    response.organizationId !== plan.state.organizationId ||
    response.parentId !== plan.state.parentContainerId
  ) {
    throw new Error("Container mutation response object identity mismatch");
  }
  // The top-level slot column is what local system-container lookups key on,
  // so it must name the slot this client signed into the manifest state; an
  // omitted slot is the server's spelling of null.
  if ((response.systemSlot ?? null) !== plan.state.systemSlot) {
    throw new Error("Container mutation response system slot mismatch");
  }
  // The manifest hash commits to the signed event (by hash), the derived
  // state, and the key target set, so equal hashes acknowledge exactly the
  // manifest this client signed.
  if (
    response.manifestHead.epoch !== plan.state.epoch ||
    response.manifestHead.manifestHash !== plan.manifestHash ||
    response.eventHash !== plan.eventHash
  ) {
    throw new Error("Container mutation response manifest head mismatch");
  }
  if (
    response.containerKek.containerKeyEpochId !== plan.keyEpoch.id ||
    response.containerKek.containerKeyEpoch !== plan.keyEpoch.keyEpoch
  ) {
    throw new Error("Container mutation response KEK identity mismatch");
  }
}

/** A rotation body commits a keyring hash; other bodies do not. */
function readOptionalKeyringHash(body: object): string | null {
  const value = Reflect.get(body, "keyringHash");
  return typeof value === "string" ? value : null;
}

/**
 * The keyring the server stored must be the one this client's own signed
 * event committed to, or, for a mutation that keeps its epoch, the immutable
 * artifact that epoch already had. The acknowledgement is the moment the
 * response becomes trusted, so the commitment is checked here.
 */
async function assertAcknowledgedKeyringHash(
  plan: AuthoredContainerMutationHead,
  keyringHash: string | null,
): Promise<void> {
  const committedHash = readOptionalKeyringHash(plan.body);
  if (committedHash !== null) {
    if (keyringHash !== committedHash) {
      throw new Error(
        "Container mutation response keyring does not match its signed event",
      );
    }
    return;
  }
  const previous = plan.previousKeyring ?? null;
  if (previous === null) {
    // The epoch had no keyring, so the response must not invent one: an
    // injected snapshot would become the next writer projection's history.
    if (keyringHash !== null) {
      throw new Error(
        "Container mutation response added a keyring to an unchanged epoch",
      );
    }
    return;
  }
  if (keyringHash === null) {
    throw new Error(
      "Container mutation response dropped its unchanged keyring",
    );
  }
  if (keyringHash !== (await computeContainerKekKeyringHash(previous))) {
    throw new Error(
      "Container mutation response replaced its unchanged keyring",
    );
  }
}

async function assertResponseCommitments(
  plan: AuthoredContainerMutationHead,
  response: ContainerMutationResponse,
): Promise<void> {
  const kek = response.containerKek;
  await assertAcknowledgedKeyringHash(plan, kek.keyringHash);
  // The recipient target hash is how the #2158 wrong-recipient checks reach
  // the acknowledgement: it commits to every wrap's recipient, so a server
  // that stored a wrap for anyone else cannot match it.
  if (
    kek.keyEpochHash !== (await computeContainerKeyEpochHash(plan.keyEpoch)) ||
    kek.keyTargetHash !==
      (await computeContainerKekRecipientTargetHash(
        expectedRecipientTargets(plan.wraps),
      )) ||
    kek.parentContainerKeyEpochId !== plan.keyEpoch.parentContainerKeyEpochId
  ) {
    throw new Error("Container mutation response KEK commitment mismatch");
  }
}

export async function locallyAcknowledgedContainerMutationHead(input: {
  readonly plan: AuthoredContainerMutationHead;
  readonly response: ContainerMutationResponse;
}): Promise<LocallyAcknowledgedAccessManifestHead> {
  assertResponseIdentity(input.plan, input.response);
  await assertResponseCommitments(input.plan, input.response);
  return {
    checkpoint: accessManifestCheckpointFromManifest({
      manifest: input.plan.manifest,
      manifestHash: input.plan.manifestHash,
    }),
    previousManifestHash: input.plan.manifest.previousManifestHash,
  };
}

/** Correlates an API acknowledgement to the locally signed plan before pinning. */
export async function acknowledgeContainerMutation(input: {
  readonly execSql: ExecSql;
  readonly plan: AuthoredContainerMutationHead;
  readonly response: ContainerMutationResponse;
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<boolean> {
  return advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
    execSql: input.execSql,
    heads: [
      await locallyAcknowledgedContainerMutationHead({
        plan: input.plan,
        response: input.response,
      }),
    ],
    stillCurrent: input.stillCurrent,
  });
}

/** Correlates and advances a complete authored mutation batch atomically. */
export async function acknowledgeContainerMutationBatch(input: {
  readonly execSql: ExecSql;
  readonly plans: readonly AuthoredContainerMutationHead[];
  readonly responses: readonly ContainerMutationResponse[];
  readonly stillCurrent?: (() => boolean) | undefined;
}): Promise<boolean> {
  if (input.plans.length !== input.responses.length) {
    throw new Error("Container mutation acknowledgement batch is incomplete");
  }
  const heads = await Promise.all(
    input.plans.map(async (plan, index) => {
      const response = input.responses[index];
      if (!response) {
        throw new Error(
          "Container mutation acknowledgement batch is incomplete",
        );
      }
      return locallyAcknowledgedContainerMutationHead({ plan, response });
    }),
  );
  return advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
    execSql: input.execSql,
    heads,
    stillCurrent: input.stillCurrent,
  });
}
