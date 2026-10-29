import { useCallback, useState } from "react";
import {
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppTable,
  MiniAppTableActionButton,
  MiniAppTableCell,
  MiniAppTableEmptyRow,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../../components/mini-app/MiniAppTable";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { formatByteLength } from "../../../utils/formatByteLength";
import { DATA_USAGE_LABELS } from "../../shared/dataUsageLabels";
import { useRootPage } from "../organizations/useRootPage";
import { OrganizationSearchForm } from "./OrganizationSearchForm";

const COLUMNS = [
  { id: "id", header: "Organization ID" },
  { id: "documents", header: "Documents" },
  { id: "blobs", header: "Files" },
  { id: "total", header: "Total usage" },
];
export function DataUsageReportView({
  onSelectOrganization,
}: {
  onSelectOrganization: (organizationId: string) => void;
}) {
  const tearleads = useTearleads();
  const [search, setSearch] = useState("");
  const request = useCallback(
    async (cursor: string | null) => {
      const result = await tearleads.root.listDataUsageReport({
        search,
        ...(cursor === null ? {} : { cursor }),
      });
      return result.ok
        ? {
            ok: true as const,
            data: {
              items: result.data.organizations,
              nextCursor: result.data.nextCursor,
            },
          }
        : result;
    },
    [search, tearleads],
  );
  const { items, error, loading, nextCursor, loadMore, refresh } =
    useRootPage(request);
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Reports · Data usage by organization</h2>
      </MiniAppSectionHeading>
      <MiniAppStatus>
        {DATA_USAGE_LABELS.usageDefinition} Shared data is counted for each
        organization it is attributed to. Organizations are listed newest first.
      </MiniAppStatus>
      <OrganizationSearchForm
        search={search}
        loading={loading}
        onSearch={setSearch}
        onRefresh={refresh}
      />
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      <MiniAppTableFrame>
        <MiniAppTable aria-label="Data usage by organization" columns={COLUMNS}>
          {items.length === 0 ? (
            <MiniAppTableEmptyRow colSpan={COLUMNS.length}>
              {loading ? "Loading organizations..." : "No organizations found."}
            </MiniAppTableEmptyRow>
          ) : (
            items.map(({ organization: org, dataUsage }) => (
              <MiniAppTableRow
                key={org.organizationId}
                interactive
                onActivate={() => onSelectOrganization(org.organizationId)}
              >
                <MiniAppTableCell>
                  <MiniAppTableActionButton
                    onClick={() => onSelectOrganization(org.organizationId)}
                  >
                    {org.organizationId}
                  </MiniAppTableActionButton>
                </MiniAppTableCell>
                {(
                  [
                    ["documents", dataUsage.documents.byteLength],
                    ["blobs", dataUsage.blobs.byteLength],
                    ["total", dataUsage.totalByteLength],
                  ] as const
                ).map(([id, bytes]) => (
                  <MiniAppTableCell key={id}>
                    <MiniAppTableText title={`${bytes.toLocaleString()} bytes`}>
                      {formatByteLength(bytes)}
                    </MiniAppTableText>
                  </MiniAppTableCell>
                ))}
              </MiniAppTableRow>
            ))
          )}
        </MiniAppTable>
      </MiniAppTableFrame>
      {nextCursor !== null && (
        <MiniAppToolbar>
          <MiniAppButton disabled={loading} onClick={loadMore}>
            Load more
          </MiniAppButton>
        </MiniAppToolbar>
      )}
    </MiniAppSection>
  );
}
