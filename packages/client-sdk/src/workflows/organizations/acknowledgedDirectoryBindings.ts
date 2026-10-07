import { KeyingVerificationError } from "@tearleads/crypto";
import type { PrincipalPolicyMutationResponse } from "@tearleads/validators/response";
import {
  parseOrganizationAuthorityDescriptor,
  principalHeadMatchesReference,
} from "../../data/principals/organizationAuthorityDescriptor";

/** Couple supplied group receipts to the directory acknowledged in the same batch. */
export function assertAcknowledgedDirectoryBindings(
  organizationId: string,
  receipts: readonly PrincipalPolicyMutationResponse[],
) {
  const directories = receipts.filter(
    (receipt) => receipt.currentState.principalType === "organization",
  );
  for (const directory of directories) {
    const descriptor = parseOrganizationAuthorityDescriptor(
      directory.currentPayload.ciphertext,
    );
    if (
      directory.currentState.principalId !== organizationId ||
      descriptor.organizationId !== organizationId ||
      receipts.some(
        ({ currentState }) =>
          currentState.principalType === "group" &&
          !descriptor.groupHeads.some((head) =>
            principalHeadMatchesReference(head, currentState),
          ),
      )
    )
      throw new KeyingVerificationError(
        "object_mismatch",
        "Acknowledged organization does not bind its group receipt",
      );
  }
}
