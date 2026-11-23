import type { Icon } from "@phosphor-icons/react";
import { ChartPieSliceIcon } from "@phosphor-icons/react/dist/csr/ChartPieSlice";
import { HeartbeatIcon } from "@phosphor-icons/react/dist/csr/Heartbeat";
import { TrashSimpleIcon } from "@phosphor-icons/react/dist/csr/TrashSimple";
import { WebhooksLogoIcon } from "@phosphor-icons/react/dist/csr/WebhooksLogo";
import type { RootReportId } from "../routes";

export interface RootReport {
  readonly description: string;
  readonly icon: Icon;
  readonly id: RootReportId;
  readonly label: string;
}

/** The Reports listing, in display order; each row opens its report. */
export const ROOT_REPORTS: ReadonlyArray<RootReport> = [
  {
    description:
      "Billing maintenance across every organization: seat syncs, trial expiry, and purges.",
    icon: HeartbeatIcon,
    id: "ops-health",
    label: "Operations health",
  },
  {
    description:
      "Webhook deliveries that matched no organization, or that the handler ignored.",
    icon: WebhooksLogoIcon,
    id: "revenuecat",
    label: "RevenueCat webhooks",
  },
  {
    description: "Stored documents and files for each organization.",
    icon: ChartPieSliceIcon,
    id: "data-usage",
    label: "Data usage",
  },
  {
    description: "Unreferenced encrypted blobs waiting to be collected.",
    icon: TrashSimpleIcon,
    id: "pending-deletion",
    label: "Pending deletion",
  },
];
