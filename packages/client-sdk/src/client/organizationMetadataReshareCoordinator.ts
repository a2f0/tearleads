import { isKeyingVerificationError } from "../data/keyingProjectionVerification/error";
import type { ContainerContents } from "./containerContents";

export type ReshareOrganizationMetadataAfterGroupChange = (input: {
  containerContents: ContainerContents;
  log: (message: string) => void;
  mutatedGroupId: string;
  organizationId: string;
}) => Promise<void>;

export interface OrganizationMetadataReshareCoordinator {
  /**
   * Best-effort re-wrap of an existing metadata read grant for the mutated
   * group. The signed container grant, rather than a directory label, decides
   * whether the operation applies.
   */
  reshareAfterGroupChange(input: {
    memberGroupId: string;
    mutatedGroupId: string;
    organizationId: string;
  }): Promise<void>;
}

export function createOrganizationMetadataReshareCoordinator(deps: {
  containerContents: ContainerContents;
  log: (message: string) => void;
  reshare: ReshareOrganizationMetadataAfterGroupChange;
}): OrganizationMetadataReshareCoordinator {
  const integrityFailedOrganizations = new Set<string>();

  return {
    async reshareAfterGroupChange({
      memberGroupId,
      mutatedGroupId,
      organizationId,
    }) {
      if (mutatedGroupId !== memberGroupId) {
        return;
      }
      if (integrityFailedOrganizations.has(organizationId)) {
        return;
      }
      try {
        await deps.reshare({
          containerContents: deps.containerContents,
          log: deps.log,
          mutatedGroupId,
          organizationId,
        });
      } catch (error) {
        if (isKeyingVerificationError(error)) {
          integrityFailedOrganizations.add(organizationId);
          deps.log(
            `Organizations: stopped org metadata re-share for org ${organizationId} after an identity integrity failure: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }
        deps.log(
          `Organizations: best-effort org metadata re-share skipped for org ${organizationId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
