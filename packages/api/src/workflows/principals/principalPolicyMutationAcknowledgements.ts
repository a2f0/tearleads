import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { principalPolicyMutationAcknowledgements } from "@tearleads/api-shared/schema";
import {
  isKeyingCanonicalJson,
  type ReferencedPrincipalHead,
  serializeKeyingCanonicalJson,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import {
  type ContainerMutationResponse,
  isContainerMutationResponse,
} from "@tearleads/validators/response";
import { and, asc, eq } from "drizzle-orm";
import { readProjectionAccessEvent } from "../../keyingProjectionRecords";
import { canonicalJsonEquals } from "../../utils/canonicalJson";
import { sha256Hex } from "../../utils/sha256";
import { PrincipalPolicyError } from "./shared";

/**
 * The stored commitment to an acknowledged request: SHA-256 over its
 * canonical JSON, domain-separated. Null for a request that is not canonical
 * JSON, which no acknowledgement can match.
 */
function mutationAcknowledgementRequestSha256(
  request: ContainerMutationRequest,
): string | null {
  if (!isKeyingCanonicalJson(request)) return null;
  return sha256Hex(
    `tearleads.principal-policy-mutation-acknowledgement-request.v1\0${serializeKeyingCanonicalJson(
      request,
    )}`,
  );
}

function requestEvent(request: ContainerMutationRequest) {
  return readProjectionAccessEvent(
    request.event,
    "Principal container rematerialization event",
    (message) => new PrincipalPolicyError(message, 400),
  );
}

export async function loadExactReplayMutationResponses(input: {
  readonly executor: DatabaseTransaction;
  readonly nextHead: ReferencedPrincipalHead;
  readonly requests: readonly ContainerMutationRequest[];
}): Promise<ContainerMutationResponse[]> {
  const rows = await input.executor
    .select({
      batchIndex: principalPolicyMutationAcknowledgements.batchIndex,
      containerId: principalPolicyMutationAcknowledgements.containerId,
      manifestHash: principalPolicyMutationAcknowledgements.manifestHash,
      requestSha256: principalPolicyMutationAcknowledgements.requestSha256,
      responseJson: principalPolicyMutationAcknowledgements.responseJson,
    })
    .from(principalPolicyMutationAcknowledgements)
    .where(
      and(
        eq(
          principalPolicyMutationAcknowledgements.principalType,
          input.nextHead.principalType,
        ),
        eq(
          principalPolicyMutationAcknowledgements.principalId,
          input.nextHead.principalId,
        ),
        eq(
          principalPolicyMutationAcknowledgements.stateHash,
          input.nextHead.stateHash,
        ),
      ),
    )
    .orderBy(asc(principalPolicyMutationAcknowledgements.batchIndex));
  if (rows.length !== input.requests.length) {
    throw new PrincipalPolicyError(
      "Principal policy container replay batch is incomplete",
      409,
    );
  }
  return rows.map((row, index) => {
    const request = input.requests[index];
    if (!request) {
      throw new PrincipalPolicyError(
        "Principal policy container replay batch is incomplete",
        409,
      );
    }
    let storedResponse: unknown;
    try {
      storedResponse = JSON.parse(row.responseJson);
    } catch {
      throw new PrincipalPolicyError(
        "Stored principal policy container acknowledgement is invalid",
        409,
      );
    }
    const event = requestEvent(request);
    if (
      row.batchIndex !== index ||
      event.objectKind !== "container" ||
      event.objectId !== row.containerId ||
      request.expectedManifestHash !== row.manifestHash ||
      mutationAcknowledgementRequestSha256(request) !== row.requestSha256 ||
      !isContainerMutationResponse(storedResponse) ||
      storedResponse.containerId !== row.containerId ||
      storedResponse.manifestHead.manifestHash !== row.manifestHash
    ) {
      throw new PrincipalPolicyError(
        "Principal policy container replay does not match its committed acknowledgement",
        409,
      );
    }
    return storedResponse;
  });
}

export async function storeMutationAcknowledgements(input: {
  readonly executor: DatabaseTransaction;
  readonly nextHead: ReferencedPrincipalHead;
  readonly requests: readonly ContainerMutationRequest[];
  readonly responses: readonly ContainerMutationResponse[];
}): Promise<void> {
  if (input.requests.length !== input.responses.length) {
    throw new Error("Principal policy container acknowledgement is incomplete");
  }
  if (input.requests.length === 0) {
    return;
  }
  await input.executor
    .insert(principalPolicyMutationAcknowledgements)
    .values(
      input.requests.map((request, batchIndex) => {
        const response = input.responses[batchIndex];
        const event = requestEvent(request);
        if (!response || event.objectKind !== "container") {
          throw new Error(
            "Principal policy container acknowledgement is invalid",
          );
        }
        const requestSha256 = mutationAcknowledgementRequestSha256(request);
        // A request no replay can match fails as its replay would.
        if (requestSha256 === null) {
          throw new PrincipalPolicyError(
            "Principal policy container replay does not match its committed acknowledgement",
            409,
          );
        }
        return {
          batchIndex,
          containerId: event.objectId,
          manifestHash: request.expectedManifestHash,
          principalId: input.nextHead.principalId,
          principalType: input.nextHead.principalType,
          requestSha256,
          responseJson: JSON.stringify(response),
          stateHash: input.nextHead.stateHash,
        };
      }),
    )
    .onConflictDoNothing({
      target: [
        principalPolicyMutationAcknowledgements.principalType,
        principalPolicyMutationAcknowledgements.principalId,
        principalPolicyMutationAcknowledgements.stateHash,
        principalPolicyMutationAcknowledgements.batchIndex,
      ],
    });
  const storedResponses = await loadExactReplayMutationResponses({
    executor: input.executor,
    nextHead: input.nextHead,
    requests: input.requests,
  });
  if (!canonicalJsonEquals(storedResponses, input.responses)) {
    throw new PrincipalPolicyError(
      "Principal policy container acknowledgement conflicts with stored state",
      409,
    );
  }
}
