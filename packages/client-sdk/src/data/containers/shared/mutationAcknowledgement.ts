import {
  type AccessEvent,
  type AccessManifest,
  accessManifestCheckpointFromManifest,
  type ContainerAccessManifestState,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  computeContainerKekKeyringHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { readCanonicalJson } from "../../keyingCanonicalJson";
import {
  advanceLocallyAcknowledgedAccessManifestHeadsAtomically,
  type LocallyAcknowledgedAccessManifestHead,
} from "../../persistence/locallyAcknowledgedCheckpointPersistence";
import type { ExecSql } from "../../sqlite/sqlSchema";

interface AuthoredContainerMutationHead {
  readonly body: object;
  readonly containerId: string;
  readonly event: AccessEvent;
  readonly eventHash: string;
  readonly keyEpoch: ContainerKeyEpoch;
  readonly manifest: AccessManifest;
  readonly manifestHash: string;
  /**
   * The keyring the epoch already had, for mutations that keep their epoch.
   * Its artifact is immutable, so the response must echo exactly this.
   */
  readonly previousKeyring?: Record<string, unknown> | null | undefined;
  readonly state: ContainerAccessManifestState;
  readonly wraps: readonly ContainerKeyWrap[];
}

function canonical(value: unknown, label: string): string {
  return serializeKeyingCanonicalJson(readCanonicalJson(value, label));
}

function assertCanonicalMatch(input: {
  readonly actual: unknown;
  readonly expected: unknown;
  readonly label: string;
}): void {
  if (
    canonical(input.actual, `${input.label} response`) !==
    canonical(input.expected, `${input.label} plan`)
  ) {
    throw new Error(`Container mutation response ${input.label} mismatch`);
  }
}

function expectedRecipientTargets(
  wraps: readonly ContainerKeyWrap[],
): ContainerKekRecipientTarget[] {
  return wraps
    .map((wrap) => ({
      recipientId: wrap.recipientId,
      recipientKeyEpochId: wrap.recipientKeyEpochId,
      recipientKeyFingerprint: wrap.recipientKeyFingerprint,
      recipientKind: wrap.recipientKind,
    }))
    .sort((left, right) =>
      canonical(left, "recipient target").localeCompare(
        canonical(right, "recipient target"),
      ),
    );
}

function sortedCanonicalValues<T>(values: readonly T[], label: string): T[] {
  return [...values].sort((left, right) =>
    canonical(left, label).localeCompare(canonical(right, label)),
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
  if (
    response.manifestHead.epoch !== plan.state.epoch ||
    response.manifestHead.manifestHash !== plan.manifestHash ||
    response.accessManifest.manifestHash !== plan.manifestHash
  ) {
    throw new Error("Container mutation response manifest head mismatch");
  }
  if (
    response.containerKek.containerId !== plan.containerId ||
    response.containerKek.accessManifestHash !== plan.manifestHash ||
    response.containerKek.containerKeyEpochId !== plan.keyEpoch.id ||
    response.containerKek.containerKeyEpoch !== plan.keyEpoch.keyEpoch
  ) {
    throw new Error("Container mutation response KEK identity mismatch");
  }
}

/**
 * The response's keyring must be the one this client's own signed event
 * committed to. Without this a server could echo a substituted snapshot and
 * have it acknowledged into durable local state — the acknowledgement is the
 * moment the response becomes trusted, so the commitment is checked here.
 */
async function assertAcknowledgedKeyring(
  plan: AuthoredContainerMutationHead,
  response: ContainerMutationResponse,
): Promise<void> {
  const body = plan.body as { keyringHash?: unknown };
  const committedHash =
    typeof body.keyringHash === "string" ? body.keyringHash : null;
  const keyring = response.containerKek.keyring;
  if (committedHash === null) {
    // A non-rotating mutation keeps its epoch, so the echoed keyring must be
    // the immutable artifact that epoch already had. Accepting anything else
    // would let a server null or substitute the snapshot in the response that
    // becomes the next writer projection.
    const expected = plan.previousKeyring ?? null;
    if (expected === null) {
      // The epoch had no keyring, so the response must not invent one: an
      // injected snapshot would become the next writer projection's history.
      if (keyring) {
        throw new Error(
          "Container mutation response added a keyring to an unchanged epoch",
        );
      }
      return;
    }
    if (!keyring) {
      throw new Error(
        "Container mutation response dropped its unchanged keyring",
      );
    }
    if (
      (await computeContainerKekKeyringHash(keyring)) !==
      (await computeContainerKekKeyringHash(expected))
    ) {
      throw new Error(
        "Container mutation response replaced its unchanged keyring",
      );
    }
    return;
  }
  if (!keyring) {
    throw new Error("Container mutation response is missing its keyring");
  }
  if ((await computeContainerKekKeyringHash(keyring)) !== committedHash) {
    throw new Error(
      "Container mutation response keyring does not match its signed event",
    );
  }
}

async function assertResponseContent(
  plan: AuthoredContainerMutationHead,
  response: ContainerMutationResponse,
): Promise<void> {
  assertCanonicalMatch({
    actual: response.accessManifest.event.event,
    expected: plan.event,
    label: "event",
  });
  assertCanonicalMatch({
    actual: response.accessManifest.event.body,
    expected: plan.body,
    label: "event body",
  });
  if (response.accessManifest.event.eventHash !== plan.eventHash) {
    throw new Error("Container mutation response event hash mismatch");
  }
  assertCanonicalMatch({
    actual: response.accessManifest.manifest,
    expected: plan.manifest,
    label: "manifest",
  });
  assertCanonicalMatch({
    actual: response.accessManifest.state,
    expected: plan.state,
    label: "state",
  });
  assertCanonicalMatch({
    actual: response.containerKek.keyEpoch,
    expected: plan.keyEpoch,
    label: "key epoch",
  });
  await assertAcknowledgedKeyring(plan, response);
  assertCanonicalMatch({
    actual: sortedCanonicalValues(response.containerKek.wraps, "response wrap"),
    expected: sortedCanonicalValues(plan.wraps, "planned wrap"),
    label: "wraps",
  });
  const recipientTargets = expectedRecipientTargets(plan.wraps);
  const responseTargets = [...response.containerKek.recipientTargets].sort(
    (left, right) =>
      canonical(left, "response recipient target").localeCompare(
        canonical(right, "response recipient target"),
      ),
  );
  assertCanonicalMatch({
    actual: responseTargets,
    expected: recipientTargets,
    label: "recipient targets",
  });
  if (
    response.containerKek.keyEpochHash !==
      (await computeContainerKeyEpochHash(plan.keyEpoch)) ||
    response.containerKek.keyTargetHash !==
      (await computeContainerKekRecipientTargetHash(recipientTargets)) ||
    response.containerKek.parentContainerKeyEpochId !==
      plan.keyEpoch.parentContainerKeyEpochId
  ) {
    throw new Error("Container mutation response KEK commitment mismatch");
  }
  assertCanonicalMatch({
    actual: response.referencedPrincipalHeads,
    expected: plan.manifest.referencedPrincipalHeads,
    label: "referenced principal heads",
  });
}

export async function locallyAcknowledgedContainerMutationHead(input: {
  readonly plan: AuthoredContainerMutationHead;
  readonly response: ContainerMutationResponse;
}): Promise<LocallyAcknowledgedAccessManifestHead> {
  assertResponseIdentity(input.plan, input.response);
  await assertResponseContent(input.plan, input.response);
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
}): Promise<void> {
  await advanceLocallyAcknowledgedAccessManifestHeadsAtomically({
    execSql: input.execSql,
    heads: [
      await locallyAcknowledgedContainerMutationHead({
        plan: input.plan,
        response: input.response,
      }),
    ],
  });
}
