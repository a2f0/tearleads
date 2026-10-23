import type { RootOrganizationDetail } from "@tearleads/client-sdk";
import { formatRootTimestamp } from "../identities/rootDisplay";
import { RootFacts } from "./RootFacts";

function seatUsage({ billing, overview }: RootOrganizationDetail): string {
  const inUse = overview.openSeatAssignmentCount;
  return billing
    ? `${inUse} of ${billing.seatCount} licensed`
    : `${inUse} (no billing record)`;
}

export function OrganizationOverview({
  detail,
}: {
  detail: RootOrganizationDetail;
}) {
  const { billing, organization, overview } = detail;
  return (
    <RootFacts
      label="Organization"
      facts={[
        {
          label: "Organization ID",
          value: organization.organizationId,
          copy: true,
        },
        {
          label: "Created",
          value: formatRootTimestamp(organization.createdAt),
        },
        { label: "Admins group ID", value: overview.adminGroupId, copy: true },
        {
          label: "Members group ID",
          value: overview.memberGroupId,
          copy: true,
        },
        { label: "Active members", value: overview.activeMemberCount },
        { label: "Disabled members", value: overview.disabledMemberCount },
        {
          label: "Sync paused by members",
          value: overview.syncPausedMemberCount,
        },
        { label: "Seats in use", value: seatUsage(detail) },
        {
          label: "Billing status",
          value: organization.billingStatus ?? "Missing",
        },
        {
          label: "Purge started",
          value: formatRootTimestamp(billing?.purgeStartedAt, "Not started"),
        },
      ]}
    />
  );
}
