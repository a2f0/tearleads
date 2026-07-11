import type {
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import type { ContainerMutationResponse } from "@tearleads/validators/response";
import { assertOrganizationCanSync } from "../../../billing/organizationBilling";
import type {
  ContainerMutationContext,
  MutateContainerWithExecutorInput,
} from "../types";
import { assertContainerBuiltinGrantPolicyPreserved } from "./builtinGrants";
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

function collectReferencedPrincipalHeads(
  paths: readonly (
    | readonly VerifiedContainerAccessManifest[]
    | null
    | undefined
  )[],
): ReferencedPrincipalHead[] {
  return paths.flatMap((path) =>
    (path ?? []).flatMap((manifest) => manifest.state.referencedPrincipalHeads),
  );
}

async function readCurrentPrincipalPolicies(input: {
  readonly executor: MutateContainerWithExecutorInput["executor"];
  readonly request: MutateContainerWithExecutorInput["request"];
  readonly referencedPrincipalHeads: readonly ReferencedPrincipalHead[];
}) {
  return assertPrincipalPoliciesCurrent(
    input.executor,
    principalPoliciesFromRequest(input.request),
    {
      referencedPrincipalHeads: input.referencedPrincipalHeads,
    },
  );
}

async function assertMutationOrganizationCanSync(
  context: ContainerMutationContext,
  eventType: MutateContainerWithExecutorInput["expectedEventType"],
  organizationId: string,
): Promise<void> {
  if (eventType === "container.create") {
    return;
  }

  await assertOrganizationCanSync(context.executor, organizationId);
}

async function loadPreviousContainerManifest(
  previousManifest: MutateContainerWithExecutorInput["request"]["previousManifest"],
): Promise<VerifiedContainerAccessManifest | null> {
  if (previousManifest === undefined || previousManifest === null) {
    return null;
  }

  return assertContainerManifestBundleConsistent(
    previousManifest,
    "previousManifest",
  );
}

async function assertPreviousManifestHeadCurrent(
  context: ContainerMutationContext,
  manifest: VerifiedContainerAccessManifest | null,
): Promise<void> {
  if (manifest) {
    await assertManifestHeadCurrent(context, manifest, "previousManifest");
  }
}

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
  const previousManifest = await loadPreviousContainerManifest(
    input.request.previousManifest,
  );
  await assertPreviousManifestHeadCurrent(context, previousManifest);
  const principalPolicies = await readCurrentPrincipalPolicies({
    executor: context.executor,
    request: input.request,
    referencedPrincipalHeads: collectReferencedPrincipalHeads([
      previousContainerPath,
      parentContainerPath,
      destinationParentContainerPath,
      containerManifestHistory,
      previousManifest ? [previousManifest] : null,
    ]),
  });

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
  await assertContainerBuiltinGrantPolicyPreserved({
    executor: context.executor,
    manifest,
    previousManifest,
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
  await assertMutationOrganizationCanSync(
    context,
    input.expectedEventType,
    manifest.state.organizationId,
  );

  return persistVerifiedMutation(
    context,
    manifest,
    kekState,
    previousManifest,
    previousContainerPath,
  );
}
