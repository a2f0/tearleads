import { useWindowRefreshMenuItem } from "@tearleads/windowing";
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
  detailLoading,
  organizationId,
  onRefreshDetail,
  onSelectIdentity,
}: {
  /** Whether the organization these deliveries sit beside is reloading. */
  detailLoading: boolean;
  organizationId: string;
  /** Reloads that organization, alongside these deliveries. */
  onRefreshDetail: () => void;
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
  // Above the organization's own Refresh while the Billing tab is open, so one
  // Refresh reloads the billing and the deliveries beside it, and stays busy
  // until both settle.
  const refreshing = loading || detailLoading;
  useWindowRefreshMenuItem({
    disabled: refreshing,
    onRefresh: () => {
      onRefreshDetail();
      refresh();
    },
    priority: 100,
    refreshing,
  });
  return (
    <>
      <MiniAppInfoHeading>RevenueCat webhooks</MiniAppInfoHeading>
      <MiniAppStatus>
        Stored deliveries resolved to this organization, whether applied or
        ignored, and transfers that moved a purchase away from it, newest first
        by event time.
      </MiniAppStatus>
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
