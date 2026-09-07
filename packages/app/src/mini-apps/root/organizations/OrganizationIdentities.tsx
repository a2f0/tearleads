import { useCallback } from "react";
import {
  MiniAppButton,
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
  { id: "key", header: "Signing Key" },
  { id: "user", header: "User ID" },
  { id: "status", header: "Roster", width: "6rem" },
  { id: "joined", header: "Joined", width: "10rem" },
  { id: "disabled", header: "Disabled", width: "10rem" },
];
export function OrganizationIdentities({
  organizationId,
  onSelectIdentity,
}: {
  organizationId: string;
  onSelectIdentity: (userId: string) => void;
}) {
  const tearleads = useTearleads();
  const request = useCallback(
    async (cursor: string | null) => {
      const result = await tearleads.root.listOrganizationIdentities(
        organizationId,
        cursor === null ? {} : { cursor },
      );
      return result.ok
        ? {
            ok: true as const,
            data: {
              items: result.data.identities,
              nextCursor: result.data.nextCursor,
            },
          }
        : result;
    },
    [organizationId, tearleads],
  );
  const { items, error, loading, nextCursor, loadMore, refresh } =
    useRootPage(request);
  return (
    <>
      <MiniAppToolbar>
        <MiniAppButton disabled={loading} onClick={refresh}>
          Refresh identities
        </MiniAppButton>
      </MiniAppToolbar>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      <MiniAppTableFrame>
        <MiniAppTable aria-label="Organization identities" columns={COLUMNS}>
          {items.length === 0 ? (
            <MiniAppTableEmptyRow colSpan={COLUMNS.length}>
              {loading ? "Loading identities..." : "No roster identities."}
            </MiniAppTableEmptyRow>
          ) : (
            items.map(({ identity, roster }) => (
              <MiniAppTableRow
                key={identity.userId}
                interactive
                onActivate={() => onSelectIdentity(identity.userId)}
              >
                <MiniAppTableCell>
                  <MiniAppTableActionButton
                    aria-label={`Open identity ${identity.signingKeyFingerprint}`}
                    onClick={() => onSelectIdentity(identity.userId)}
                    title={identity.signingKeyFingerprint}
                  >
                    {compactRootIdentifier(identity.signingKeyFingerprint)}
                  </MiniAppTableActionButton>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText title={identity.userId}>
                    {compactRootIdentifier(identity.userId)}
                    {identity.defaultOrganizationId === organizationId
                      ? " (default)"
                      : ""}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText>{roster.status}</MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText truncate={false}>
                    {formatRootTimestamp(roster.joinedAt)}
                  </MiniAppTableText>
                </MiniAppTableCell>
                <MiniAppTableCell>
                  <MiniAppTableText truncate={false}>
                    {formatRootTimestamp(roster.disabledAt)}
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
            Load more identities
          </MiniAppButton>
        </MiniAppToolbar>
      )}
    </>
  );
}
