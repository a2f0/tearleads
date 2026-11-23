import type { Icon } from "@phosphor-icons/react";
import { ChartPieSliceIcon } from "@phosphor-icons/react/dist/csr/ChartPieSlice";
import { HeartbeatIcon } from "@phosphor-icons/react/dist/csr/Heartbeat";
import { TrashSimpleIcon } from "@phosphor-icons/react/dist/csr/TrashSimple";
import { WebhooksLogoIcon } from "@phosphor-icons/react/dist/csr/WebhooksLogo";
import { ROOT_REPORT_IDS, type RootReportId } from "../routes";

export interface RootReport {
  readonly description: string;
  readonly icon: Icon;
  readonly id: RootReportId;
  readonly label: string;
}

// Keyed by report, so a report id without a listing row does not compile.
const ROOT_REPORT_ROWS: Record<RootReportId, Omit<RootReport, "id">> = {
  "ops-health": {
    description:
      "Billing maintenance across every organization: seat syncs, trial expiry, and purges.",
    icon: HeartbeatIcon,
    label: "Operations health",
  },
  revenuecat: {
    description:
      "Webhook deliveries that matched no organization, or that the handler ignored.",
    icon: WebhooksLogoIcon,
    label: "RevenueCat webhooks",
  },
  "data-usage": {
    description: "Stored documents and files for each organization.",
    icon: ChartPieSliceIcon,
    label: "Data usage",
  },
  "pending-deletion": {
    description: "Unreferenced encrypted blobs waiting to be collected.",
    icon: TrashSimpleIcon,
    label: "Pending deletion",
  },
};

/** The Reports listing, in display order; each row opens its report. */
export const ROOT_REPORTS: ReadonlyArray<RootReport> = ROOT_REPORT_IDS.map(
  (id) => ({ id, ...ROOT_REPORT_ROWS[id] }),
);
