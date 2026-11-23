import { RevenuecatReportView } from "../revenuecat/RevenuecatReportView";
import type { RootOrganizationTab, RootReportId } from "../routes";
import { DataUsageReportView } from "./DataUsageReportView";
import { OpsHealthReportView } from "./OpsHealthReportView";
import { PendingBlobDeletionReport } from "./PendingBlobDeletionReport";

/** One report, opened from the Reports listing. */
export function RootReportView({
  onSelectIdentity,
  onSelectOrganization,
  reportId,
}: {
  onSelectIdentity: (userId: string) => void;
  onSelectOrganization: (
    organizationId: string,
    tab: RootOrganizationTab,
  ) => void;
  reportId: RootReportId;
}) {
  const openOrganizationTab =
    (tab: RootOrganizationTab) => (organizationId: string) =>
      onSelectOrganization(organizationId, tab);
  switch (reportId) {
    case "ops-health":
      return (
        <OpsHealthReportView
          onSelectOrganization={openOrganizationTab("billing")}
        />
      );
    case "revenuecat":
      return (
        <RevenuecatReportView
          onSelectIdentity={onSelectIdentity}
          onSelectOrganization={openOrganizationTab("billing")}
        />
      );
    case "data-usage":
      return (
        <DataUsageReportView
          onSelectOrganization={openOrganizationTab("data-usage")}
        />
      );
    case "pending-deletion":
      return <PendingBlobDeletionReport />;
  }
}
