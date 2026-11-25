import type { OrganizationDirectoryUser } from "@tearleads/client-sdk";
import { MiniAppButton } from "../../../components/mini-app/MiniAppLayout";
import { ORG_MANAGER_LABELS } from "../labels";

/** An administrator's control over a member's two-factor requirement. */
export interface RosterTwoFactorRequirement {
  readonly mutating: boolean;
  readonly set: (userId: string, required: boolean) => Promise<void>;
}

export function rosterTwoFactorLabel(
  user: Pick<OrganizationDirectoryUser, "twoFactorRequired">,
): string {
  return user.twoFactorRequired
    ? ORG_MANAGER_LABELS.twoFactorRequired
    : ORG_MANAGER_LABELS.twoFactorNotRequired;
}

export function RosterTwoFactorToggle({
  requirement,
  user,
}: {
  readonly requirement: RosterTwoFactorRequirement;
  readonly user: Pick<
    OrganizationDirectoryUser,
    "status" | "twoFactorRequired" | "userId"
  >;
}) {
  return (
    <MiniAppButton
      disabled={requirement.mutating || user.status !== "active"}
      onClick={() => void requirement.set(user.userId, !user.twoFactorRequired)}
      type="button"
      variant="ghost"
    >
      {user.twoFactorRequired
        ? ORG_MANAGER_LABELS.twoFactorStopRequiring
        : ORG_MANAGER_LABELS.twoFactorRequire}
    </MiniAppButton>
  );
}
