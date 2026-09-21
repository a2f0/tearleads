import { ContainerAuthorAccessError } from "../../data/containers/shared/authorAccess";
import {
  ContainerKekRepairInaccessibleError,
  ContainerKekRepairRequiredError,
} from "../../data/documents/shared/containerKekCurrency";

/**
 * Why the SDK refused to author a container-scoped write before anything was
 * encrypted or sent:
 *
 * - `repair-required`: the path cites a retired ancestor key epoch. Retry; this
 *   writer's next document sync pass, or a peer, re-keys it parent-first.
 * - `repair-inaccessible`: the same, but the stale container is one this writer
 *   can neither re-key nor be given the key for. Queued changes stay queued and
 *   sync once a member with access to `containerId` repairs it.
 * - `unauthorized`: the signed path grants this signer too little access.
 */
export type ContainerWriteRefusal =
  | { readonly kind: "repair-required"; readonly containerId: string }
  | { readonly kind: "repair-inaccessible"; readonly containerId: string }
  | { readonly kind: "unauthorized" };

function namedError(error: unknown, name: string): error is Error {
  return error instanceof Error && error.name === name;
}

/** Null for anything else, including keying-verification failures. */
export function classifyContainerWriteRefusal(
  error: unknown,
): ContainerWriteRefusal | null {
  // Match by name as well: a host bundling the SDK twice holds two classes.
  if (
    error instanceof ContainerKekRepairInaccessibleError ||
    namedError(error, "ContainerKekRepairInaccessibleError")
  ) {
    return {
      kind: "repair-inaccessible",
      containerId: String(Reflect.get(error, "containerId")),
    };
  }
  if (
    error instanceof ContainerKekRepairRequiredError ||
    namedError(error, "ContainerKekRepairRequiredError")
  ) {
    return {
      kind: "repair-required",
      containerId: String(Reflect.get(error, "containerId")),
    };
  }
  if (
    error instanceof ContainerAuthorAccessError ||
    namedError(error, "ContainerAuthorAccessError")
  ) {
    return { kind: "unauthorized" };
  }
  return null;
}
