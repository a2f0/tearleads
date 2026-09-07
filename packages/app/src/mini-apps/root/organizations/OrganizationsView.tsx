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
import {
  compactRootIdentifier,
  formatRootTimestamp,
} from "../identities/rootDisplay";
import { useRootPage } from "./useRootPage";

const COLUMNS = [
  { id: "name", header: "Organization" },
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
  const [draft, setDraft] = useState("");
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
                    {org.name}
                  </MiniAppTableActionButton>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText title={org.organizationId}>
                    {compactRootIdentifier(org.organizationId)}
                  </MiniAppTableText>
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
