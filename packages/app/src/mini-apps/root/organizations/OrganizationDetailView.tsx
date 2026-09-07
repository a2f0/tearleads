import type { RootOrganizationDetail } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MiniAppButton,
  MiniAppInfoHeading,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import {
  describeRootFailure,
  describeThrown,
  formatRootTimestamp,
} from "../identities/rootDisplay";
import { OrganizationBilling } from "./OrganizationBilling";
import { OrganizationBillingHistory } from "./OrganizationBillingHistory";
import { OrganizationIdentities } from "./OrganizationIdentities";
import { RootFacts } from "./RootFacts";

export function OrganizationDetailView({
  organizationId,
  onBack,
  onSelectIdentity,
}: {
  organizationId: string;
  onBack: () => void;
  onSelectIdentity: (userId: string) => void;
}) {
  const tearleads = useTearleads();
  const [detail, setDetail] = useState<RootOrganizationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const started = ++sequence.current;
    setLoading(true);
    setError(null);
    setDetail(null);
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
        <h2>Organization</h2>
      </MiniAppSectionHeading>
      <MiniAppToolbar>
        <MiniAppButton onClick={onBack}>Back</MiniAppButton>
        <MiniAppButton disabled={loading} onClick={() => void load()}>
          {loading ? "Loading..." : "Refresh"}
        </MiniAppButton>
      </MiniAppToolbar>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      {detail ? (
        <>
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
                value: formatRootTimestamp(detail.organization.createdAt),
              },
            ]}
          />
          <OrganizationBilling
            billing={detail.billing}
            stripe={detail.stripe}
          />
          <OrganizationBillingHistory entries={detail.history} />
          <MiniAppInfoHeading>Identities</MiniAppInfoHeading>
          <OrganizationIdentities
            organizationId={organizationId}
            onSelectIdentity={onSelectIdentity}
          />
        </>
      ) : (
        loading && <MiniAppStatus>Loading organization...</MiniAppStatus>
      )}
    </MiniAppSection>
  );
}
