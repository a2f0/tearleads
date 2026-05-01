import type { ContainerMutationResponse } from "@tearleads/validators/response";
import type {
  ContainerMutationContext,
  MutateContainerWithExecutorInput,
} from "../types";
import { verifyContainerKekFromRequest } from "./containerKek";
import {
  assertAccessEventDependenciesMatchRequest,
  verifyMutationEvent,
} from "./events";
import {
  assertContainerManifestBundleConsistent,
  assertCurrentContainerPath,
  assertHistoricalContainerManifestsConsistent,
  assertManifestHeadCurrent,
  assertMutationHeadCanAdvance,
  verifyContainerManifestFromRequest,
} from "./manifests";
import { persistVerifiedMutation } from "./persistence";
import { assertPrincipalPoliciesCurrent } from "./principalPolicies";
import { principalPoliciesFromRequest } from "./principalPolicyRecords";

export async function mutateContainerWithExecutor(
  input: MutateContainerWithExecutorInput,
): Promise<ContainerMutationResponse> {
  const context: ContainerMutationContext = input.context ?? {
    executor: input.executor,
    manifestHeadByContainerId: new Map(),
  };

  await assertCurrentContainerPath(
    context,
    input.request.previousContainerPath,
    "previousContainerPath",
  );
  await assertCurrentContainerPath(
    context,
    input.request.parentContainerPath,
    "parentContainerPath",
  );
  await assertCurrentContainerPath(
    context,
    input.request.destinationParentContainerPath,
    "destinationParentContainerPath",
  );
  await assertHistoricalContainerManifestsConsistent(
    input.request.containerManifestHistory,
  );
  if (input.request.previousManifest) {
    const previousManifest = await assertContainerManifestBundleConsistent(
      input.request.previousManifest,
      "previousManifest",
    );
    await assertManifestHeadCurrent(
      context,
      previousManifest,
      "previousManifest",
    );
  }
  await assertPrincipalPoliciesCurrent(
    context.executor,
    principalPoliciesFromRequest(input.request),
  );

  const event = await verifyMutationEvent(context.executor, input);
  assertAccessEventDependenciesMatchRequest(input.request, event);
  const manifest = await verifyContainerManifestFromRequest(
    input.request,
    event,
  );
  await assertMutationHeadCanAdvance(context, manifest);
  const kekState = await verifyContainerKekFromRequest(
    context.executor,
    input.request,
    manifest,
  );

  return persistVerifiedMutation(context, manifest, kekState);
}
