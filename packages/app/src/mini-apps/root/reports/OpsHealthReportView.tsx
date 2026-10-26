import type { RootOpsHealthReport } from "@tearleads/client-sdk";
import {
  ROOT_OPS_HEALTH_OVERDUE_MINUTES,
  ROOT_OPS_HEALTH_UPCOMING_DAYS,
} from "@tearleads/validators/response";
import {
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { formatRootTimestamp } from "../identities/rootDisplay";
import { type OpsHealthColumn, OpsHealthTable } from "./OpsHealthTable";
import { useRootOpsHealthReport } from "./useRootOpsHealthReport";

type Rows<Key extends keyof RootOpsHealthReport> =
  RootOpsHealthReport[Key] extends { rows: ReadonlyArray<infer Row> }
    ? Row
    : never;

const SEAT_SYNC_CONDITION_LABELS = {
  failing: "Failing",
  leaseExpired: "Lease lapsed",
  stalled: "Overdue",
} as const;

const date = (value: string | null) => formatRootTimestamp(value, "None");
const lastError = (value: string | null) => value ?? "None";

const SEAT_SYNC_COLUMNS: ReadonlyArray<OpsHealthColumn<Rows<"seatSync">>> = [
  {
    id: "condition",
    header: "Condition",
    cell: (row) =>
      row.conditions
        .map((condition) => SEAT_SYNC_CONDITION_LABELS[condition])
        .join(", "),
  },
  { id: "attempts", header: "Attempts", cell: (row) => row.attemptCount },
  {
    id: "revision",
    header: "Applied / desired",
    cell: (row) => `${row.appliedRevision} / ${row.desiredRevision}`,
  },
  {
    id: "next",
    header: "Next attempt",
    cell: (row) => date(row.nextAttemptAt),
  },
  {
    id: "synced",
    header: "Last synced",
    cell: (row) => formatRootTimestamp(row.lastSyncedAt),
  },
  {
    id: "error",
    header: "Last error",
    cell: (row) => lastError(row.lastError),
  },
];

const TRIAL_EXPIRY_COLUMNS: ReadonlyArray<
  OpsHealthColumn<Rows<"trialExpiry">>
> = [
  { id: "ended", header: "Trial ended", cell: (row) => date(row.trialEndsAt) },
  {
    id: "attempts",
    header: "Attempts",
    cell: (row) =>
      row.requiresAttention
        ? `${row.attemptCount} (needs attention)`
        : row.attemptCount,
  },
  {
    id: "next",
    header: "Next attempt",
    cell: (row) => date(row.nextAttemptAt),
  },
  {
    id: "error",
    header: "Last error",
    cell: (row) => lastError(row.lastError),
  },
];

const PURGE_COLUMNS: ReadonlyArray<OpsHealthColumn<Rows<"purges">>> = [
  {
    id: "state",
    header: "State",
    cell: (row) => (row.status === "deleting" ? "Claim lapsed" : "Not started"),
  },
  { id: "after", header: "Purge after", cell: (row) => date(row.purgeAfter) },
  {
    id: "started",
    header: "Purge started",
    cell: (row) => date(row.purgeStartedAt),
  },
];

const TRIALS_ENDING_COLUMNS: ReadonlyArray<
  OpsHealthColumn<Rows<"trialsEnding">>
> = [
  { id: "ends", header: "Trial ends", cell: (row) => date(row.trialEndsAt) },
];

const PURGES_DUE_COLUMNS: ReadonlyArray<OpsHealthColumn<Rows<"purgesDue">>> = [
  { id: "disabled", header: "Disabled", cell: (row) => date(row.disabledAt) },
  { id: "after", header: "Purge after", cell: (row) => date(row.purgeAfter) },
];

export function OpsHealthReportView({
  onSelectOrganization,
}: {
  onSelectOrganization: (organizationId: string) => void;
}) {
  const { error, loading, refresh, report } = useRootOpsHealthReport();
  const overdue = `${ROOT_OPS_HEALTH_OVERDUE_MINUTES} minutes`;
  const upcoming = `${ROOT_OPS_HEALTH_UPCOMING_DAYS} days`;
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Reports · Operations health</h2>
      </MiniAppSectionHeading>
      <MiniAppStatus>
        Billing maintenance across every organization.
        {report && ` Generated ${formatRootTimestamp(report.generatedAt)}.`}
      </MiniAppStatus>
      <MiniAppToolbar>
        <MiniAppButton disabled={loading} onClick={refresh}>
          {loading ? "Loading..." : "Refresh"}
        </MiniAppButton>
      </MiniAppToolbar>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      {report && (
        <>
          <OpsHealthTable
            label="Seat sync"
            description={`Stripe seat syncs the worker retries: a failed last attempt, a sync due for more than ${overdue}, or a claim whose lease lapsed.`}
            empty="No seat sync problems."
            columns={SEAT_SYNC_COLUMNS}
            section={report.seatSync}
            onSelectOrganization={onSelectOrganization}
          />
          <OpsHealthTable
            label="Trial expiry"
            description={`Ended trials the expiry sweep failed on, or has not reached ${overdue} after they ended.`}
            empty="No trial expiry problems."
            columns={TRIAL_EXPIRY_COLUMNS}
            section={report.trialExpiry}
            onSelectOrganization={onSelectOrganization}
          />
          <OpsHealthTable
            label="Purges"
            description={`Disabled organizations whose purge has been due for more than ${overdue}, and purges whose claim lapsed.`}
            empty="No purge problems."
            columns={PURGE_COLUMNS}
            section={report.purges}
            onSelectOrganization={onSelectOrganization}
          />
          <OpsHealthTable
            label="Trials ending soon"
            description={`Trials ending within ${upcoming}, soonest first.`}
            empty="No trials end soon."
            columns={TRIALS_ENDING_COLUMNS}
            section={report.trialsEnding}
            onSelectOrganization={onSelectOrganization}
          />
          <OpsHealthTable
            label="Purges due soon"
            description={`Disabled organizations whose purge falls due within ${upcoming}.`}
            empty="No purges fall due soon."
            columns={PURGES_DUE_COLUMNS}
            section={report.purgesDue}
            onSelectOrganization={onSelectOrganization}
          />
        </>
      )}
    </MiniAppSection>
  );
}
