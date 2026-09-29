import { ContainerPathTooDeepError } from "../../../data/containers/shared/containerPathLimits";
import {
  isContainerManifestAlreadyExistsConflict,
  isContainerPathTooDeepFailure,
} from "../../../data/containers/shared/mutationFailures";
import type { ContainerMutationSubmitFailure } from "../../../data/containers/shared/types";

/**
 * Classify a create refusal that no repair can answer. A lost response re-sends
 * the same stable ids and the server reports the manifest already exists: the
 * container committed remotely, the benign outcome of an idempotent retry that
 * reconciles via hydration (as document creates do), so it is not reported. A
 * path-length refusal is final: the intent waits for a local move.
 */
export function settleTerminalCreateFailure(
  failure: ContainerMutationSubmitFailure,
  stillCurrent: (() => boolean) | undefined,
): "committed" | "failed" {
  if (isContainerManifestAlreadyExistsConflict(failure)) return "committed";
  if (isContainerPathTooDeepFailure(failure))
    throw new ContainerPathTooDeepError();
  if (stillCurrent?.() !== false) failure.report();
  return "failed";
}
