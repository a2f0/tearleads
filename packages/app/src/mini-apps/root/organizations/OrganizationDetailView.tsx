import type { RootOrganizationDetail } from "@tearleads/client-sdk";
import { useWindowRefreshMenuItem } from "@tearleads/windowing";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppTabList,
  MiniAppTabPanel,
} from "../../../components/mini-app/MiniAppLayout";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { describeRootFailure, describeThrown } from "../identities/rootDisplay";
import { OrganizationRevenuecatEvents } from "../revenuecat/OrganizationRevenuecatEvents";
import { ROOT_ORGANIZATION_TABS, type RootOrganizationTab } from "../routes";
import { OrganizationBilling } from "./OrganizationBilling";
import { OrganizationBillingHistory } from "./OrganizationBillingHistory";
import { OrganizationDataUsage } from "./OrganizationDataUsage";
import { OrganizationIdentities } from "./OrganizationIdentities";
import { OrganizationOverview } from "./OrganizationOverview";

// The tabs drawn from the loaded organization detail.
function OrganizationDetailTabs({
  activeTab,
  detail,
  detailLoading,
  organizationId,
  onRefreshDetail,
  onSelectIdentity,
}: {
  activeTab: RootOrganizationTab;
  detail: RootOrganizationDetail;
  detailLoading: boolean;
  organizationId: string;
  onRefreshDetail: () => void;
  onSelectIdentity: (userId: string) => void;
}) {
  return (
    <>
      {activeTab === "overview" && <OrganizationOverview detail={detail} />}
      {activeTab === "billing" && (
        <>
          <OrganizationBilling
            billing={detail.billing}
            stripe={detail.stripe}
          />
          <OrganizationRevenuecatEvents
            detailLoading={detailLoading}
            onRefreshDetail={onRefreshDetail}
            organizationId={organizationId}
            onSelectIdentity={onSelectIdentity}
          />
        </>
      )}
      {activeTab === "history" && (
        <OrganizationBillingHistory entries={detail.history} />
      )}
    </>
  );
}

export function OrganizationDetailView({
  organizationId,
  activeTab,
  onTabChange,
  onSelectIdentity,
}: {
  organizationId: string;
  activeTab: RootOrganizationTab;
  onTabChange: (tab: RootOrganizationTab) => void;
  onSelectIdentity: (userId: string) => void;
}) {
  const tearleads = useTearleads();
  const idPrefix = useId();
  const [detail, setDetail] = useState<RootOrganizationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const started = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const result = await tearleads.root.loadOrganization(organizationId);
      if (started !== sequence.current) return;
      if (result.ok) setDetail(result.data);
      else setError(describeRootFailure(result));
    } catch (error) {
      if (started === sequence.current) setError(describeThrown(error));
    } finally {
      if (started === sequence.current) setLoading(false);
    }
  }, [organizationId, tearleads]);
  useEffect(() => {
    void load();
    return () => {
      sequence.current += 1;
    };
  }, [load]);
  const refresh = useCallback(() => void load(), [load]);
  // The Identities and Data Usage tabs, and the Billing tab's deliveries,
  // register their own Refresh above this one while open.
  useWindowRefreshMenuItem({
    disabled: loading,
    onRefresh: refresh,
    refreshing: loading,
  });
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>{detail?.organization.organizationId || "Organization"}</h2>
      </MiniAppSectionHeading>
      <MiniAppTabList
        activeTab={activeTab}
        idPrefix={idPrefix}
        label="Organization details"
        onSelect={onTabChange}
        tabs={ROOT_ORGANIZATION_TABS}
      />
      <MiniAppTabPanel activeTab={activeTab} idPrefix={idPrefix}>
        {activeTab === "data-usage" ? (
          <OrganizationDataUsage organizationId={organizationId} />
        ) : activeTab === "identities" ? (
          <OrganizationIdentities
            organizationId={organizationId}
            onSelectIdentity={onSelectIdentity}
          />
        ) : (
          <>
            {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
            {detail ? (
              <OrganizationDetailTabs
                activeTab={activeTab}
                detail={detail}
                detailLoading={loading}
                organizationId={organizationId}
                onRefreshDetail={refresh}
                onSelectIdentity={onSelectIdentity}
              />
            ) : (
              loading && <MiniAppStatus>Loading organization...</MiniAppStatus>
            )}
          </>
        )}
      </MiniAppTabPanel>
    </MiniAppSection>
  );
}
