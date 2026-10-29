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
import { formatRootTimestamp } from "../identities/rootDisplay";
import { OrganizationSearchForm } from "../reports/OrganizationSearchForm";
import { useRootPage } from "./useRootPage";

const COLUMNS = [
  { id: "id", header: "Organization ID" },
  { id: "billing", header: "Billing", width: "7rem" },
  { id: "created", header: "Created", width: "10rem" },
];
export function OrganizationsView({
  onSelectOrganization,
}: {
  onSelectOrganization: (organizationId: string) => void;
}) {
  const tearleads = useTearleads();
  const [search, setSearch] = useState("");
  const request = useCallback(
    async (cursor: string | null) => {
      const result = await tearleads.root.listOrganizations({
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
        <h2>Organizations</h2>
      </MiniAppSectionHeading>
      <OrganizationSearchForm
        search={search}
        loading={loading}
        onSearch={setSearch}
        onRefresh={refresh}
      />
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      <MiniAppTableFrame>
        <MiniAppTable aria-label="Organizations" columns={COLUMNS}>
          {items.length === 0 ? (
            <MiniAppTableEmptyRow colSpan={COLUMNS.length}>
              {loading ? "Loading organizations..." : "No organizations found."}
            </MiniAppTableEmptyRow>
          ) : (
            items.map((org) => (
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
                <MiniAppTableCell>
                  <MiniAppTableText>
                    {org.billingStatus ?? "Missing"}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText truncate={false}>
                    {formatRootTimestamp(org.createdAt)}
                  </MiniAppTableText>
                </MiniAppTableCell>
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
