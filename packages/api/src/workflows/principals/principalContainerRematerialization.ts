import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
} from "@tearleads/api-shared/schema";
import type {
  ContainerGrantPrincipalHead,
  PrincipalContainerGrant,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { MAX_ROTATION_CONTAINER_REKEYS } from "@tearleads/validators/util";
import { and, eq } from "drizzle-orm";
import {
  readProjectionAccessEvent,
  readProjectionPlainRecord,
  readProjectionString,
} from "../../keyingProjectionRecords";
import { ContainerMutationError } from "../containers/mutations/errors";
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

function requirePrincipalGrantAccessLevel(
  value: string,
): PrincipalContainerGrant["accessLevel"] {
  if (value !== "admin" && value !== "read" && value !== "write") {
    throw new Error(
      "Stored principal container grant has an invalid access level",
    );
  }
  return value;
}

interface CurrentPrincipalContainerGrant extends PrincipalContainerGrant {
  readonly keyEpoch: number | null;
  readonly keyFingerprint: string | null;
  readonly stateHash: string | null;
  readonly version: number | null;
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

export async function listCurrentPrincipalContainerGrants(input: {
  readonly executor: DatabaseTransaction;
  readonly principalId: string;
}): Promise<CurrentPrincipalContainerGrant[]> {
  const rows = await input.executor
    .select({
      accessLevel: accessManifestContainerGrantProjection.accessLevel,
      containerId: accessManifestContainerGrantProjection.containerId,
      keyEpoch: accessManifestPrincipalHeadProjection.keyEpoch,
      keyFingerprint: accessManifestPrincipalHeadProjection.keyFingerprint,
      stateHash: accessManifestPrincipalHeadProjection.stateHash,
      version: accessManifestPrincipalHeadProjection.version,
    })
    .from(accessManifestContainerGrantProjection)
    .innerJoin(
      accessManifestHeads,
      and(
        eq(accessManifestHeads.objectKind, "container"),
        eq(
          accessManifestHeads.objectId,
          accessManifestContainerGrantProjection.containerId,
        ),
        eq(
          accessManifestHeads.manifestHash,
          accessManifestContainerGrantProjection.manifestHash,
        ),
      ),
    )
    .leftJoin(
      accessManifestPrincipalHeadProjection,
      and(
        eq(
          accessManifestPrincipalHeadProjection.manifestHash,
          accessManifestContainerGrantProjection.manifestHash,
        ),
        eq(accessManifestPrincipalHeadProjection.principalType, "group"),
        eq(
          accessManifestPrincipalHeadProjection.principalId,
          input.principalId,
        ),
      ),
    )
    .where(
      and(
        eq(accessManifestContainerGrantProjection.subjectType, "group"),
        eq(accessManifestContainerGrantProjection.subjectId, input.principalId),
      ),
    );

  return rows
    .map((row) => ({
      ...row,
      accessLevel: requirePrincipalGrantAccessLevel(row.accessLevel),
    }))
    .sort((left, right) => left.containerId.localeCompare(right.containerId));
}

async function listRequiredContainerRematerializations(input: {
  readonly executor: DatabaseTransaction;
  readonly nextGrants: readonly PrincipalContainerGrant[];
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
  const nextByContainerId = new Map(
    input.nextGrants.map((grant) => [grant.containerId, grant] as const),
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

function carriedRekeyInput(input: {
  readonly carriedContainerIds: Set<string>;
  readonly event: ReturnType<typeof requestEvent>;
  readonly fingerprint: string;
  readonly request: ContainerMutationRequest;
  readonly requiredByContainerId: ReadonlyMap<string, unknown>;
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
  if (
    input.requiredByContainerId.has(event.objectId) ||
    input.carriedContainerIds.has(event.objectId)
  ) {
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
 * container the batch does not otherwise rotate. They are checked after the
 * batch applies; a rekey citing an epoch not yet minted fails on its own.
 */
function rematerializationInputs(input: {
  readonly fingerprint: string;
  readonly nextHead: ContainerGrantPrincipalHead;
  readonly previousKeyEpoch: number | null;
  readonly requests: readonly ContainerMutationRequest[];
  readonly required: readonly RequiredContainerRematerialization[];
  readonly userId: string;
}): MutateContainerInput[] {
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
        requiredByContainerId,
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
  if (
    carriedContainerIds.size > 0 &&
    !inputs.some(
      (entry) =>
        entry.expectedContainerId !== undefined &&
        requiredByContainerId.has(entry.expectedContainerId) &&
        entry.expectedEventType !== "container.grant",
    )
  ) {
    throw new PrincipalPolicyError(
      "Principal policy carries descendant rekeys without a rotation",
      409,
    );
  }
  return inputs;
}

export async function applyPrincipalContainerRematerializations(input: {
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly isExactReplay: boolean;
  readonly nextHead: ContainerGrantPrincipalHead;
  readonly nextGrants: readonly PrincipalContainerGrant[];
  readonly previousKeyEpoch: number | null;
  readonly requests?: readonly ContainerMutationRequest[] | undefined;
  readonly userId: string;
}): Promise<ContainerMutationResponse[]> {
  const required = await listRequiredContainerRematerializations({
    executor: input.executor,
    nextGrants: input.nextGrants,
    nextHead: input.nextHead,
  });
  if (input.isExactReplay && required.length === 0) {
    return loadExactReplayMutationResponses({
      executor: input.executor,
      nextHead: input.nextHead,
      requests: input.requests ?? [],
    });
  }
  const mutationInputs = rematerializationInputs({
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
    nextHead: input.nextHead,
  });
  if (unresolved.length > 0) {
    throw new ContainerMutationError(
      "Principal policy left stale container grants",
      409,
    );
  }
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
