import type { RootOrganizationDetail } from "@tearleads/client-sdk";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppTabList,
  MiniAppTabPanel,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import {
  describeRootFailure,
  describeThrown,
  formatRootTimestamp,
} from "../identities/rootDisplay";
import { ROOT_ORGANIZATION_TABS, type RootOrganizationTab } from "../routes";
import { OrganizationBilling } from "./OrganizationBilling";
import { OrganizationBillingHistory } from "./OrganizationBillingHistory";
import { OrganizationDataUsage } from "./OrganizationDataUsage";
import { OrganizationIdentities } from "./OrganizationIdentities";
import { RootFacts } from "./RootFacts";

export function OrganizationDetailView({
  organizationId,
  activeTab,
  onTabChange,
  onBack,
  onSelectIdentity,
}: {
  organizationId: string;
  activeTab: RootOrganizationTab;
  onTabChange: (tab: RootOrganizationTab) => void;
  onBack: () => void;
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
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>{detail?.organization.name || "Organization"}</h2>
      </MiniAppSectionHeading>
      <MiniAppToolbar>
        <MiniAppButton onClick={onBack}>Back</MiniAppButton>
        {activeTab !== "data-usage" && activeTab !== "identities" && (
          <MiniAppButton disabled={loading} onClick={() => void load()}>
            {loading ? "Loading..." : "Refresh"}
          </MiniAppButton>
        )}
      </MiniAppToolbar>
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
              <>
                {activeTab === "overview" && (
                  <RootFacts
                    label="Organization"
                    facts={[
                      { label: "Name", value: detail.organization.name },
                      {
                        label: "Organization ID",
                        value: detail.organization.organizationId,
                        copy: true,
                      },
                      {
                        label: "Created",
                        value: formatRootTimestamp(
                          detail.organization.createdAt,
                        ),
                      },
                    ]}
                  />
                )}
                {activeTab === "billing" && (
                  <OrganizationBilling
                    billing={detail.billing}
                    stripe={detail.stripe}
                  />
                )}
                {activeTab === "history" && (
                  <OrganizationBillingHistory entries={detail.history} />
                )}
              </>
            ) : (
              loading && <MiniAppStatus>Loading organization...</MiniAppStatus>
            )}
          </>
        )}
      </MiniAppTabPanel>
    </MiniAppSection>
  );
}
