import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import type {
  ContainerGrantPrincipalHead,
  PrincipalContainerGrant,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import {
  readProjectionAccessEvent,
  readProjectionPlainRecord,
  readProjectionString,
} from "../../keyingProjectionRecords";
import { ContainerMutationError } from "../containers/mutations/errors";
import { assertCarriedRekeysBelowRotations } from "../containers/mutations/shared/carriedRekeyAncestry";
import { assertGrantedPathsCurrentBelowRotations } from "../containers/mutations/shared/grantedPathCurrency";
import {
  mutateContainerWithExecutor,
  prelockContainerMutationBatch,
} from "../containers/mutations/shared/mutationRunner";
import type {
  ContainerMutationContext,
  MutateContainerInput,
} from "../containers/mutations/types";
import { createContainerWriterProjectionContext } from "../containers/writerProjection";
import {
  listCurrentPrincipalContainerGrants,
  livePrincipalContainerGrants,
} from "./principalContainerGrants";
import {
  loadExactReplayMutationResponses,
  storeMutationAcknowledgements,
} from "./principalPolicyMutationAcknowledgements";
import { PrincipalPolicyError } from "./shared";

type RematerializationEventType =
  | "container.grant"
  | "container.rekey"
  | "container.revoke";

interface RequiredContainerRematerialization {
  readonly containerId: string;
  readonly eventType: RematerializationEventType;
}

function principalHeadMatches(
  row: {
    readonly keyEpoch: number | null;
    readonly keyFingerprint: string | null;
    readonly stateHash: string | null;
    readonly version: number | null;
  },
  head: ContainerGrantPrincipalHead,
): boolean {
  return (
    row.version === head.version &&
    row.keyEpoch === head.keyEpoch &&
    row.stateHash === head.stateHash &&
    row.keyFingerprint === head.keyFingerprint
  );
}

async function listRequiredContainerRematerializations(input: {
  readonly executor: DatabaseTransaction;
  readonly nextGrants: readonly PrincipalContainerGrant[];
  readonly previousGrants: readonly PrincipalContainerGrant[];
  readonly organizationId: string;
  readonly nextHead: ContainerGrantPrincipalHead;
}): Promise<RequiredContainerRematerialization[]> {
  const head = input.nextHead;
  const rows = await listCurrentPrincipalContainerGrants({
    executor: input.executor,
    principalId: head.principalId,
  });
  const currentByContainerId = new Map(
    rows.map((row) => [row.containerId, row] as const),
  );
  const liveNextGrants = await livePrincipalContainerGrants(
    input.executor,
    input.nextGrants,
    input.previousGrants,
    input.organizationId,
  );
  const nextByContainerId = new Map(
    liveNextGrants.map((grant) => [grant.containerId, grant] as const),
  );
  const containerIds = [
    ...new Set([...currentByContainerId.keys(), ...nextByContainerId.keys()]),
  ].sort();

  const required: RequiredContainerRematerialization[] = [];
  for (const containerId of containerIds) {
    const row = currentByContainerId.get(containerId);
    const next = nextByContainerId.get(containerId);
    if (!row) {
      if (next) {
        required.push({ containerId, eventType: "container.grant" });
      }
      continue;
    }
    if (!next) {
      required.push({ containerId, eventType: "container.revoke" });
      continue;
    }
    if (row.accessLevel !== next.accessLevel) {
      required.push({ containerId, eventType: "container.grant" });
      continue;
    }
    if (!principalHeadMatches(row, head)) {
      if (row.keyEpoch === null) {
        throw new PrincipalPolicyError(
          "Container grant is missing its principal reference",
          409,
        );
      }
      required.push({
        containerId: row.containerId,
        eventType:
          row.keyEpoch === head.keyEpoch
            ? "container.grant"
            : "container.rekey",
      });
    }
  }
  return required;
}

function requestEvent(
  request: ContainerMutationRequest,
): ReturnType<typeof readProjectionAccessEvent> {
  return readProjectionAccessEvent(
    request.event,
    "Principal container rematerialization event",
    (message) => new PrincipalPolicyError(message, 400),
  );
}

function isRotatingPrincipalRevoke(input: {
  readonly nextHead: ContainerGrantPrincipalHead;
  readonly previousKeyEpoch: number | null;
  readonly request: ContainerMutationRequest;
}): boolean {
  if (
    input.previousKeyEpoch === null ||
    input.nextHead.keyEpoch <= input.previousKeyEpoch
  ) {
    return false;
  }
  const error = (message: string) => new PrincipalPolicyError(message, 400);
  const body = readProjectionPlainRecord(
    input.request.body,
    "Principal container rematerialization body",
    error,
  );
  return (
    readProjectionString(
      body,
      "eventType",
      "Principal container rematerialization body",
      error,
    ) === "container.revoke" &&
    readProjectionString(
      body,
      "subjectType",
      "Principal container rematerialization body",
      error,
    ) === input.nextHead.principalType &&
    readProjectionString(
      body,
      "subjectId",
      "Principal container rematerialization body",
      error,
    ) === input.nextHead.principalId
  );
}

/** An entry outside the required set: a rekey of a container carried once. */
function carriedRekeyInput(input: {
  readonly carriedContainerIds: Set<string>;
  readonly event: ReturnType<typeof requestEvent>;
  readonly fingerprint: string;
  readonly request: ContainerMutationRequest;
  readonly userId: string;
}): MutateContainerInput {
  const { event } = input;
  if (
    event.objectKind !== "container" ||
    event.eventType !== "container.rekey"
  ) {
    throw new PrincipalPolicyError(
      "Principal policy may carry only container rekeys beyond its rematerializations",
      409,
    );
  }
  if (input.carriedContainerIds.has(event.objectId)) {
    throw new PrincipalPolicyError(
      "Principal policy rotates a container twice",
      409,
    );
  }
  input.carriedContainerIds.add(event.objectId);
  return {
    expectedContainerId: event.objectId,
    expectedEventType: "container.rekey",
    fingerprint: input.fingerprint,
    request: input.request,
    userId: input.userId,
  };
}

/**
 * Beyond the required set a batch may carry descendant rekeys: a rekey or
 * revoke among the rematerializations is a rotation like any other, and must
 * not leave a level above a directly granted container pinned to a retired
 * epoch. The client orders the whole batch parent-first, carried levels between
 * the rematerializations they sit under, so position says nothing here; an
 * entry is required by its container, and anything else must be a rekey of a
 * container the batch does not otherwise rotate, sitting below one it does.
 * Both that and what they leave current are checked after the batch applies;
 * a rekey citing an epoch not yet minted fails on its own.
 */
function rematerializationInputs(input: {
  readonly fingerprint: string;
  readonly nextHead: ContainerGrantPrincipalHead;
  readonly previousKeyEpoch: number | null;
  readonly requests: readonly ContainerMutationRequest[];
  readonly required: readonly RequiredContainerRematerialization[];
  readonly userId: string;
}): {
  carriedContainerIds: string[];
  inputs: MutateContainerInput[];
  rotatedContainerIds: string[];
} {
  const requiredByContainerId = new Map(
    input.required.map((entry) => [entry.containerId, entry] as const),
  );
  const seenContainerIds = new Set<string>();
  const carriedContainerIds = new Set<string>();
  const inputs = input.requests.map((request): MutateContainerInput => {
    const event = requestEvent(request);
    const required = requiredByContainerId.get(event.objectId);
    if (!required) {
      return carriedRekeyInput({
        carriedContainerIds,
        event,
        fingerprint: input.fingerprint,
        request,
        userId: input.userId,
      });
    }
    const isPrincipalRevoke =
      event.eventType === "container.revoke" &&
      isRotatingPrincipalRevoke({
        nextHead: input.nextHead,
        previousKeyEpoch: input.previousKeyEpoch,
        request,
      });
    if (
      event.objectKind !== "container" ||
      seenContainerIds.has(event.objectId) ||
      (event.eventType !== required.eventType && !isPrincipalRevoke)
    ) {
      throw new PrincipalPolicyError(
        "Principal policy container rematerialization batch is incomplete or invalid",
        409,
      );
    }
    seenContainerIds.add(event.objectId);
    return {
      expectedContainerId: event.objectId,
      expectedEventType: event.eventType,
      fingerprint: input.fingerprint,
      request,
      userId: input.userId,
    };
  });
  if (seenContainerIds.size < requiredByContainerId.size) {
    throw new PrincipalPolicyError(
      "Principal policy must rematerialize every stale container grant",
      409,
    );
  }
  if (carriedContainerIds.size > MAX_ROTATION_CONTAINER_REKEYS) {
    throw new PrincipalPolicyError(
      "Principal policy carries too many descendant rekeys",
      409,
    );
  }
  // A grant keeps its epoch and strands nothing, so a batch of grants alone
  // has nothing to carry; a rekey riding on one is a rotation in disguise.
  const rotatedContainerIds = inputs.flatMap((entry) =>
    entry.expectedContainerId !== undefined &&
    requiredByContainerId.has(entry.expectedContainerId) &&
    entry.expectedEventType !== "container.grant"
      ? [entry.expectedContainerId]
      : [],
  );
  if (carriedContainerIds.size > 0 && rotatedContainerIds.length === 0) {
    throw new PrincipalPolicyError(
      "Principal policy carries descendant rekeys without a rotation",
      409,
    );
  }
  return {
    carriedContainerIds: [...carriedContainerIds],
    inputs,
    rotatedContainerIds,
  };
}

export async function applyPrincipalContainerRematerializations(input: {
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly isExactReplay: boolean;
  readonly nextHead: ContainerGrantPrincipalHead;
  readonly nextGrants: readonly PrincipalContainerGrant[];
  readonly previousGrants: readonly PrincipalContainerGrant[];
  readonly organizationId: string;
  readonly previousKeyEpoch: number | null;
  readonly requests?: readonly ContainerMutationRequest[] | undefined;
  readonly userId: string;
}): Promise<ContainerMutationResponse[]> {
  const required = await listRequiredContainerRematerializations({
    executor: input.executor,
    nextGrants: input.nextGrants,
    previousGrants: input.previousGrants,
    organizationId: input.organizationId,
    nextHead: input.nextHead,
  });
  if (input.isExactReplay && required.length === 0) {
    return loadExactReplayMutationResponses({
      executor: input.executor,
      nextHead: input.nextHead,
      requests: input.requests ?? [],
    });
  }
  const {
    carriedContainerIds,
    inputs: mutationInputs,
    rotatedContainerIds,
  } = rematerializationInputs({
    fingerprint: input.fingerprint,
    nextHead: input.nextHead,
    previousKeyEpoch: input.previousKeyEpoch,
    requests: input.requests ?? [],
    required,
    userId: input.userId,
  });
  if (mutationInputs.length === 0) {
    return [];
  }

  const context: ContainerMutationContext = {
    executor: input.executor,
    mutatingGroupPrincipalId: input.nextHead.principalId,
    manifestHeadByContainerId: new Map(),
    verifiedManifestByHash: new Map(),
    writerProjectionContext: createContainerWriterProjectionContext(
      input.executor,
    ),
  };
  await prelockContainerMutationBatch(context, mutationInputs);
  const responses: ContainerMutationResponse[] = [];
  for (const mutation of mutationInputs) {
    responses.push(
      await mutateContainerWithExecutor({
        ...mutation,
        context,
        executor: input.executor,
      }),
    );
  }

  const unresolved = await listRequiredContainerRematerializations({
    executor: input.executor,
    nextGrants: input.nextGrants,
    previousGrants: input.previousGrants,
    organizationId: input.organizationId,
    nextHead: input.nextHead,
  });
  if (unresolved.length > 0) {
    throw new ContainerMutationError(
      "Principal policy left stale container grants",
      409,
    );
  }
  // Each carried rekey must sit below a rotation of this batch. Checked once
  // every entry has been verified and applied under the batch locks, so the
  // ids are known containers and the refusal rolls the batch back whole.
  await assertCarriedRekeysBelowRotations({
    carriedContainerIds,
    executor: input.executor,
    rotatedContainerIds,
  });
  // Every rekey or revoke here rotated a container; what it carried rode with
  // it. A grant keeps its epoch and strands nothing.
  await assertGrantedPathsCurrentBelowRotations({
    carriedLimit: MAX_ROTATION_CONTAINER_REKEYS,
    executor: input.executor,
    rotated: responses.filter(
      (_response, index) =>
        mutationInputs[index]?.expectedEventType !== "container.grant",
    ),
  });
  await storeMutationAcknowledgements({
    executor: input.executor,
    nextHead: input.nextHead,
    requests: input.requests ?? [],
    responses,
  });
  return responses;
}
