import { useCallback, useState } from "react";
import {
  MiniAppButton,
  MiniAppInput,
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
import { compactRootIdentifier } from "../identities/rootDisplay";
import { useRootPage } from "../organizations/useRootPage";

const COLUMNS = [
  { id: "name", header: "Organization" },
  { id: "id", header: "Organization ID" },
  { id: "documents", header: "Documents" },
  { id: "blobs", header: "Blobs" },
  { id: "total", header: "Total usage" },
];
export function DataUsageReportView({
  onSelectOrganization,
}: {
  onSelectOrganization: (organizationId: string) => void;
}) {
  const tearleads = useTearleads();
  const [draft, setDraft] = useState("");
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
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (search === draft.trim()) refresh();
          else setSearch(draft.trim());
        }}
      >
        <MiniAppToolbar wrap>
          <MiniAppInput
            aria-label="Search organizations"
            placeholder="Organization name or ID"
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            className="root-console-filter"
          />
          <MiniAppButton type="submit" disabled={loading}>
            Search
          </MiniAppButton>
          <MiniAppButton disabled={loading} onClick={refresh}>
            {loading ? "Loading..." : "Refresh"}
          </MiniAppButton>
        </MiniAppToolbar>
      </form>
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
                    {org.name || "Untitled organization"}
                  </MiniAppTableActionButton>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText title={org.organizationId}>
                    {compactRootIdentifier(org.organizationId)}
                  </MiniAppTableText>
                </MiniAppTableCell>
                {[
                  dataUsage.documents.byteLength,
                  dataUsage.blobs.byteLength,
                  dataUsage.totalByteLength,
                ].map((bytes, index) => (
                  <MiniAppTableCell key={COLUMNS[index + 2]?.id}>
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
