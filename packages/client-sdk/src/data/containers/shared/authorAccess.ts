import {
  type AnyVerifiedPrincipalPolicy,
  KeyingVerificationError,
  resolveContainerStatePathUserAccessLevel,
} from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { readContainerState } from "./projection";
import type { ContainerMutationAuthor } from "./types";

export class ContainerAuthorAccessError extends Error {
  readonly code = "unauthorized";
  readonly status = 403;
}

/** Call after verifying the path; readable keys alone do not authorize signing. */
export function assertContainerAuthorAccess(input: {
  author: ContainerMutationAuthor;
  minimumAccess: "write" | "admin";
  principalPolicies: readonly AnyVerifiedPrincipalPolicy[];
  projection: ContainerWriterProjectionResponse;
}): void {
  const states = input.projection.path.map(readContainerState);
  if (
    states.some((state) => state.organizationId !== input.author.organizationId)
  )
    throw new KeyingVerificationError(
      "object_mismatch",
      "Container author organization differs from the verified path",
    );
  const access = resolveContainerStatePathUserAccessLevel({
    states,
    principalPolicies: input.principalPolicies,
    userId: input.author.signerUserId,
  });
  if (
    access !== "admin" &&
    !(input.minimumAccess === "write" && access === "write")
  )
    throw new ContainerAuthorAccessError(
      `Container signer lacks ${input.minimumAccess} access on the verified path`,
    );
}
