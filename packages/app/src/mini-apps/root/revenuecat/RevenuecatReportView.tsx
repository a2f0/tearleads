import type { RootRevenuecatDisposition } from "@tearleads/validators/response";
import { useCallback, useState } from "react";
import {
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppSelect,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { useRootPage } from "../organizations/useRootPage";
import { RevenuecatDeliveries } from "./RevenuecatDeliveries";

const DISPOSITION_OPTIONS: ReadonlyArray<{
  label: string;
  value: RootRevenuecatDisposition;
}> = [
  { label: "Unmatched or ignored", value: "both" },
  { label: "Unmatched only", value: "unmatched" },
  { label: "Ignored only", value: "ignored" },
];

function isDisposition(value: string): value is RootRevenuecatDisposition {
  return DISPOSITION_OPTIONS.some((option) => option.value === value);
}

export function RevenuecatReportView({
  onSelectIdentity,
  onSelectOrganization,
}: {
  onSelectIdentity: (userId: string) => void;
  onSelectOrganization: (organizationId: string) => void;
}) {
  const tearleads = useTearleads();
  const [disposition, setDisposition] =
    useState<RootRevenuecatDisposition>("both");
  const request = useCallback(
    async (cursor: string | null) => {
      const result = await tearleads.root.listRevenuecatEventsReport({
        disposition,
        ...(cursor === null ? {} : { cursor }),
      });
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
    [disposition, tearleads],
  );
  const { items, error, loading, nextCursor, loadMore, refresh } =
    useRootPage(request);
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Reports · RevenueCat webhooks needing attention</h2>
      </MiniAppSectionHeading>
      <MiniAppStatus>
        Deliveries that resolved to no organization, or that the webhook handler
        ignored, newest first by event time. A buyer who paid but never got sync
        usually shows up here.
      </MiniAppStatus>
      <MiniAppToolbar wrap>
        <MiniAppSelect
          aria-label="Deliveries to list"
          value={disposition}
          onChange={(event) => {
            if (isDisposition(event.target.value)) {
              setDisposition(event.target.value);
            }
          }}
        >
          {DISPOSITION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </MiniAppSelect>
        <MiniAppButton disabled={loading} onClick={refresh}>
          Refresh webhooks
        </MiniAppButton>
      </MiniAppToolbar>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      {items.length === 0 ? (
        <MiniAppStatus>
          {loading ? "Loading deliveries..." : "No deliveries need attention."}
        </MiniAppStatus>
      ) : (
        <RevenuecatDeliveries
          deliveries={items}
          onSelectIdentity={onSelectIdentity}
          onSelectOrganization={onSelectOrganization}
        />
      )}
      {nextCursor !== null && (
        <MiniAppToolbar>
          <MiniAppButton disabled={loading} onClick={loadMore}>
            Load more deliveries
          </MiniAppButton>
        </MiniAppToolbar>
      )}
    </MiniAppSection>
  );
}
