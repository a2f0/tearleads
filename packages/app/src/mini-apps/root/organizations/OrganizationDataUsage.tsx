import type { OrganizationDataUsage as Usage } from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MiniAppButton,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { DataUsageView } from "../../shared/DataUsageView";
import { describeRootFailure, describeThrown } from "../identities/rootDisplay";

export function OrganizationDataUsage({
  organizationId,
}: {
  organizationId: string;
}) {
  const tearleads = useTearleads();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const started = ++sequence.current;
    setLoading(true);
    setUsage(null);
    setError(null);
    try {
      const result =
        await tearleads.root.loadOrganizationDataUsage(organizationId);
      if (started !== sequence.current) return;
      if (result.ok) setUsage(result.data);
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
    <>
      <MiniAppToolbar>
        <MiniAppButton disabled={loading} onClick={() => void load()}>
          {loading ? "Loading..." : "Refresh usage"}
        </MiniAppButton>
      </MiniAppToolbar>
      {error ? (
        <MiniAppStatus tone="error">{error}</MiniAppStatus>
      ) : (
        <DataUsageView canSync={null} dataUsage={usage} pending={loading} />
      )}
    </>
  );
}
