import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import { principalPolicyMutationAcknowledgements } from "@symcrypt/api-shared/schema";
import type { ReferencedPrincipalHead } from "@symcrypt/crypto";
import {
  type ContainerMutationRequest,
  isContainerMutationRequest,
} from "@symcrypt/validators/request";
import {
  type ContainerMutationResponse,
  isContainerMutationResponse,
} from "@symcrypt/validators/response";
import { and, asc, eq } from "drizzle-orm";
import { readProjectionAccessEvent } from "../../keyingProjectionRecords";
import { canonicalJsonEquals } from "../../utils/canonicalJson";
import { PrincipalPolicyError } from "./shared";

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
      requestJson: principalPolicyMutationAcknowledgements.requestJson,
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
    let storedRequest: unknown;
    let storedResponse: unknown;
    try {
      storedRequest = JSON.parse(row.requestJson);
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
      !isContainerMutationRequest(storedRequest) ||
      !canonicalJsonEquals(storedRequest, request) ||
      !isContainerMutationResponse(storedResponse) ||
      storedResponse.containerId !== row.containerId ||
      storedResponse.accessManifest.manifestHash !== row.manifestHash
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
        return {
          batchIndex,
          containerId: event.objectId,
          manifestHash: request.expectedManifestHash,
          principalId: input.nextHead.principalId,
          principalType: input.nextHead.principalType,
          requestJson: JSON.stringify(request),
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
