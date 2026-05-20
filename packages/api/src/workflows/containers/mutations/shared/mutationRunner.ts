import type { ContainerMutationResponse } from "@tearleads/validators/response";
import type {
  ContainerMutationContext,
  MutateContainerWithExecutorInput,
} from "../types";
import { assertContainerBuiltinGrantNotMutated } from "./builtinGrants";
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

  const previousContainerPath = await assertCurrentContainerPath(
    context,
    input.request.previousContainerPath,
    "previousContainerPath",
  );
  const parentContainerPath = await assertCurrentContainerPath(
    context,
    input.request.parentContainerPath,
    "parentContainerPath",
  );
  const destinationParentContainerPath = await assertCurrentContainerPath(
    context,
    input.request.destinationParentContainerPath,
    "destinationParentContainerPath",
  );
  const containerManifestHistory =
    await assertHistoricalContainerManifestsConsistent(
      input.request.containerManifestHistory,
    );
  const previousManifest =
    input.request.previousManifest === undefined ||
    input.request.previousManifest === null
      ? null
      : await assertContainerManifestBundleConsistent(
          input.request.previousManifest,
          "previousManifest",
        );

  if (previousManifest) {
    await assertManifestHeadCurrent(
      context,
      previousManifest,
      "previousManifest",
    );
  }
  const principalPolicies = principalPoliciesFromRequest(input.request);
  await assertPrincipalPoliciesCurrent(context.executor, principalPolicies);

  const event = await verifyMutationEvent(context.executor, input);
  assertAccessEventDependenciesMatchRequest(input.request, event);
  const manifest = await verifyContainerManifestFromRequest(
    input.request,
    event,
    {
      destinationParentContainerPath,
      parentContainerPath,
      previousContainerPath,
      previousManifest,
      principalPolicies,
    },
  );
  await assertContainerBuiltinGrantNotMutated({
    executor: context.executor,
    manifest,
  });
  await assertMutationHeadCanAdvance(context, manifest);
  const kekState = await verifyContainerKekFromRequest(
    context.executor,
    input.request,
    manifest,
    {
      containerManifestHistory,
      principalPolicies,
    },
  );

  return persistVerifiedMutation(
    context,
    manifest,
    kekState,
    previousManifest,
    previousContainerPath,
  );
}
