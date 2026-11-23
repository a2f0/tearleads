import { useRoutedLayoutTier } from "@tearleads/windowing";
import {
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../components/mini-app/MiniAppTable";
import type { RootReportId } from "../routes";
import { ROOT_REPORTS } from "./rootReports";

const COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { header: "Report", id: "report", width: "18rem" },
  { header: "Description", id: "description" },
];
// A phone has no room for a second column, so each description sits under its
// report's name instead.
const COMPACT_COLUMNS: ReadonlyArray<MiniAppTableColumn> = [
  { header: "Report", id: "report" },
];

/** The Reports listing: one row per report, each opening that report. */
export function ReportsView({
  onSelectReport,
}: {
  onSelectReport: (reportId: RootReportId) => void;
}) {
  const compact = useRoutedLayoutTier() === "mobile";
  const columns = compact ? COMPACT_COLUMNS : COLUMNS;
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Reports</h2>
      </MiniAppSectionHeading>
      <MiniAppTableFrame>
        <MiniAppTable aria-label="Reports" columns={columns}>
          {ROOT_REPORTS.map(({ description, icon: ReportIcon, id, label }) => (
            <MiniAppTableRow
              key={id}
              interactive
              onActivate={() => onSelectReport(id)}
            >
              <MiniAppTableCell>
                <MiniAppTableActionButton
                  className="root-console-report-name"
                  onClick={() => onSelectReport(id)}
                >
                  <ReportIcon aria-hidden size={18} />
                  <MiniAppTableText>{label}</MiniAppTableText>
                </MiniAppTableActionButton>
                {compact && (
                  <MiniAppTableText
                    className="root-console-report-summary"
                    muted
                    truncate={false}
                  >
                    {description}
                  </MiniAppTableText>
                )}
              </MiniAppTableCell>
              {!compact && (
                <MiniAppTableCell>
                  <MiniAppTableText muted title={description}>
                    {description}
                  </MiniAppTableText>
                </MiniAppTableCell>
              )}
            </MiniAppTableRow>
          ))}
        </MiniAppTable>
      </MiniAppTableFrame>
    </MiniAppSection>
  );
}
