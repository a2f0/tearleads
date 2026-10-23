import { useCallback } from "react";
import {
  MiniAppButton,
  MiniAppInfoHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { useRootPage } from "../organizations/useRootPage";
import { RevenuecatDeliveries } from "./RevenuecatDeliveries";

export function OrganizationRevenuecatEvents({
  organizationId,
  onSelectIdentity,
}: {
  organizationId: string;
  onSelectIdentity: (userId: string) => void;
}) {
  const tearleads = useTearleads();
  const request = useCallback(
    async (cursor: string | null) => {
      const result = await tearleads.root.listOrganizationRevenuecatEvents(
        organizationId,
        cursor === null ? {} : { cursor },
      );
      return result.ok
        ? {
            ok: true as const,
            data: {
              items: result.data.events,
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
      <MiniAppInfoHeading>RevenueCat webhooks</MiniAppInfoHeading>
      <MiniAppStatus>
        Stored deliveries applied to this organization, and transfers that moved
        a purchase away from it, newest first by event time.
      </MiniAppStatus>
      <MiniAppToolbar>
        <MiniAppButton disabled={loading} onClick={refresh}>
          Refresh deliveries
        </MiniAppButton>
      </MiniAppToolbar>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      {items.length === 0 ? (
        <MiniAppStatus>
          {loading ? "Loading deliveries..." : "No RevenueCat deliveries."}
        </MiniAppStatus>
      ) : (
        <RevenuecatDeliveries
          deliveries={items}
          onSelectIdentity={onSelectIdentity}
        />
      )}
      {nextCursor !== null && (
        <MiniAppToolbar>
          <MiniAppButton disabled={loading} onClick={loadMore}>
            Load more deliveries
          </MiniAppButton>
        </MiniAppToolbar>
      )}
    </>
  );
}
