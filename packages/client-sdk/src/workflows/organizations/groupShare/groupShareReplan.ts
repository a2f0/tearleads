import { KeyingVerificationError } from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { ProjectionDependencyUnavailableError } from "../../../data/keyingProjectionVerification/dependencyUnavailable";

/** The share's remote writes; nothing may be replanned once one has run. */
const GROUP_SHARE_WRITES = new Set([
  "commitOrganizationGroupPolicy",
  "shareContainer",
  "shareContainerResult",
]);

interface ReplannableGroupShareInput<Api extends object> {
  readonly apiClient: Api & {
    evictContainerWriterProjection(containerId: string): void;
  };
  readonly containerId: string;
  readonly previousProjection?: ContainerWriterProjectionResponse | undefined;
  readonly stillCurrent?: (() => boolean) | undefined;
}

/**
 * A cached path can trail a pin this device advanced (a rollback), or its
 * history a checkpoint another workflow pinned meanwhile (a retryable missing
 * dependency). A fresh projection resolves both and is held to the same pins.
 */
function isStaleShareEvidence(error: unknown): boolean {
  return (
    error instanceof ProjectionDependencyUnavailableError ||
    (error instanceof KeyingVerificationError && error.code === "rollback")
  );
}

function recordWrites<Api extends object>(api: Api, onWrite: () => void): Api {
  return new Proxy(api, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const bound = (...args: unknown[]): unknown =>
        Reflect.apply(value, target, args);
      if (typeof property !== "string" || !GROUP_SHARE_WRITES.has(property))
        return bound;
      return (...args: unknown[]): unknown => {
        onWrite();
        return bound(...args);
      };
    },
  });
}

/**
 * Plan a group share once more from a fresh projection when its evidence was
 * stale, as a user share and a create do, but only while no remote write (the
 * group grant policy or the share itself) has been submitted: a write may have
 * landed, and replaying it is not this retry's call. A second stale plan fails.
 */
export async function shareWithGroupReplanningOnce<
  Api extends object,
  Input extends ReplannableGroupShareInput<Api>,
  Result,
>(
  input: Input,
  attempt: (input: Input) => Promise<Result | null>,
): Promise<Result | null> {
  let wrote = false;
  try {
    return await attempt({
      ...input,
      apiClient: recordWrites(input.apiClient, () => {
        wrote = true;
      }),
    });
  } catch (error) {
    if (wrote || !isStaleShareEvidence(error)) throw error;
  }
  if (input.stillCurrent?.() === false) return null;
  input.apiClient.evictContainerWriterProjection(input.containerId);
  return attempt({ ...input, previousProjection: undefined });
}
