import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessManifestContainerGrantProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
} from "@tearleads/api-shared/schema";
import type {
  PrincipalContainerGrant,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import {
  readProjectionAccessEvent,
  readProjectionPlainRecord,
  readProjectionString,
} from "../../keyingProjectionRecords";
import { ContainerMutationError } from "../containers/mutations/errors";
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
  head: ReferencedPrincipalHead,
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
  readonly principalType: "group" | "organization";
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
        eq(
          accessManifestPrincipalHeadProjection.principalType,
          input.principalType,
        ),
        eq(
          accessManifestPrincipalHeadProjection.principalId,
          input.principalId,
        ),
      ),
    )
    .where(
      and(
        eq(
          accessManifestContainerGrantProjection.subjectType,
          input.principalType,
        ),
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
  readonly nextHead: ReferencedPrincipalHead;
}): Promise<RequiredContainerRematerialization[]> {
  const head = input.nextHead;
  const rows = await listCurrentPrincipalContainerGrants({
    executor: input.executor,
    principalId: head.principalId,
    principalType: head.principalType,
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
  readonly nextHead: ReferencedPrincipalHead;
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

function rematerializationInputs(input: {
  readonly fingerprint: string;
  readonly nextHead: ReferencedPrincipalHead;
  readonly previousKeyEpoch: number | null;
  readonly requests: readonly ContainerMutationRequest[];
  readonly required: readonly RequiredContainerRematerialization[];
  readonly userId: string;
}): MutateContainerInput[] {
  const requiredByContainerId = new Map(
    input.required.map((entry) => [entry.containerId, entry] as const),
  );
  if (input.requests.length < requiredByContainerId.size) {
    throw new PrincipalPolicyError(
      "Principal policy must rematerialize every stale container grant",
      409,
    );
  }
  if (input.requests.length > requiredByContainerId.size) {
    throw new PrincipalPolicyError(
      "Principal policy contains unexpected container rematerializations",
      409,
    );
  }

  const seenContainerIds = new Set<string>();
  return input.requests.map((request) => {
    const event = requestEvent(request);
    const required = requiredByContainerId.get(event.objectId);
    const isPrincipalRevoke =
      event.eventType === "container.revoke" &&
      isRotatingPrincipalRevoke({
        nextHead: input.nextHead,
        previousKeyEpoch: input.previousKeyEpoch,
        request,
      });
    if (
      event.objectKind !== "container" ||
      !required ||
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
}

export async function applyPrincipalContainerRematerializations(input: {
  readonly executor: DatabaseTransaction;
  readonly fingerprint: string;
  readonly isExactReplay: boolean;
  readonly nextHead: ReferencedPrincipalHead;
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
  if (input.nextHead.principalType === "organization") {
    if (required.length > 0) {
      throw new PrincipalPolicyError(
        "Organization principal changes with existing container grants are not supported",
        409,
      );
    }
    if ((input.requests?.length ?? 0) > 0) {
      throw new PrincipalPolicyError(
        "Organization principal policies cannot include container rematerializations",
        409,
      );
    }
    return [];
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
    ...(input.nextHead.principalType === "group"
      ? { mutatingGroupPrincipalId: input.nextHead.principalId }
      : {}),
    manifestHeadByContainerId: new Map(),
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
  await storeMutationAcknowledgements({
    executor: input.executor,
    nextHead: input.nextHead,
    requests: input.requests ?? [],
    responses,
  });
  return responses;
}
