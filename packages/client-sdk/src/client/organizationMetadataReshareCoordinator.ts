import { isKeyingVerificationError } from "../data/keyingProjectionVerification/error";
import type { ContainerContents } from "./containerContents";

// Minimal shape the coordinator needs from an org directory lookup. Kept
// structural (rather than importing the full directory type) so the service can
// adapt the rich `loadOrganizationDirectoryAndGroups` result at the boundary and
// tests can supply a trivial fake.
export interface OrganizationDirectoryForReshare {
  memberGroupId: string | null;
}

export type LoadOrganizationDirectoryForReshare = (
  organizationId: string,
) => Promise<OrganizationDirectoryForReshare | null>;

// Matches `reshareOrganizationMetadataToMembers`; injected so the coordinator
// can be unit-tested without the container-contents facade.
export type ReshareOrganizationMetadataToMembers = (input: {
  containerContents: ContainerContents;
  log: (message: string) => void;
  memberGroupId: string;
  mutatedGroupId: string;
  organizationId: string;
}) => Promise<void>;

export interface OrganizationMetadataReshareCoordinator {
  /**
   * After a group membership change, re-share the org metadata container to the
   * Members group so a rotated group's members keep read access to the org name.
   * Best-effort and self-guarding: it resolves nothing and never rejects, so
   * callers fire it and forget.
   */
  reshareAfterGroupChange(input: {
    mutatedGroupId: string;
    organizationId: string;
  }): Promise<void>;
}

/**
 * Coordinates the best-effort org-metadata re-share triggered by a group change.
 * Extracted from `OrganizationsService` so its three load-bearing behaviors are
 * unit-testable in isolation from the heavy add/remove-member mutations:
 *
 *   1. Gate — only a change to the *Members* group re-shares; a change to any
 *      other group (e.g. Admins) is ignored, so we never touch unrelated
 *      containers.
 *   2. Memoize — the Members group id is a random, immutable UUID minted at
 *      registration, so a successful lookup is cached (a failed one is not,
 *      leaving a later attempt free to retry).
 *   3. Best-effort — the triggering mutation has already committed, so nothing
 *      here may throw into the caller. Availability failures are logged;
 *      identity integrity failures stop later attempts for this coordinator.
 *
 * `log` is invoked (not captured) per call so it always reflects the current
 * runtime's logger, mirroring the original inline implementation.
 */
export function createOrganizationMetadataReshareCoordinator(deps: {
  containerContents: ContainerContents;
  loadDirectory: LoadOrganizationDirectoryForReshare;
  log: (message: string) => void;
  reshare: ReshareOrganizationMetadataToMembers;
}): OrganizationMetadataReshareCoordinator {
  const integrityFailedOrganizations = new Set<string>();
  const memberGroupIdByOrganization = new Map<string, string>();

  async function resolveMemberGroupId(
    organizationId: string,
  ): Promise<string | null> {
    const cached = memberGroupIdByOrganization.get(organizationId);
    if (cached) {
      return cached;
    }
    const directory = await deps.loadDirectory(organizationId);
    const memberGroupId = directory?.memberGroupId ?? null;
    if (memberGroupId) {
      memberGroupIdByOrganization.set(organizationId, memberGroupId);
    }
    return memberGroupId;
  }

  return {
    async reshareAfterGroupChange({ mutatedGroupId, organizationId }) {
      if (integrityFailedOrganizations.has(organizationId)) {
        return;
      }
      try {
        const memberGroupId = await resolveMemberGroupId(organizationId);
        if (!memberGroupId || mutatedGroupId !== memberGroupId) {
          return;
        }
        await deps.reshare({
          containerContents: deps.containerContents,
          log: deps.log,
          memberGroupId,
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
