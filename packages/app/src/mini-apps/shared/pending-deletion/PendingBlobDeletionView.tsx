import {
  MiniAppButton,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { PendingBlobDeletionTable } from "./PendingBlobDeletionTable";
import type { PendingBlobDeletionLoader } from "./pendingBlobDeletionState";
import { usePendingBlobDeletions } from "./usePendingBlobDeletions";

export function PendingBlobDeletionView({
  request,
  showOrganization = false,
}: {
  request: PendingBlobDeletionLoader;
  showOrganization?: boolean;
}) {
  const { state, refresh, loadMore } = usePendingBlobDeletions(request);
  const loading = state.status === "idle" || state.status === "loading";
  return (
    <MiniAppSection>
      <MiniAppSectionHeading>
        <h2>Pending deletion</h2>
      </MiniAppSectionHeading>
      <MiniAppStatus>
        Server snapshot of unreferenced encrypted blobs. Eligibility is not a
        deletion deadline; maintenance may retry later. Reattaching before
        collection cancels deletion. This is not a recovery or
        attachment-history view.
      </MiniAppStatus>
      <MiniAppToolbar>
        <MiniAppButton disabled={loading} onClick={refresh}>
          {loading ? "Loading..." : "Refresh"}
        </MiniAppButton>
      </MiniAppToolbar>
      {state.status === "failed" ? (
        <MiniAppStatus tone="error">{state.message}</MiniAppStatus>
      ) : (
        <PendingBlobDeletionTable
          loading={loading}
          rows={state.status === "idle" ? [] : state.rows}
          showOrganization={showOrganization}
        />
      )}
      {state.status === "ready" && state.nextAfterId !== null && (
        <MiniAppToolbar>
          <MiniAppButton onClick={loadMore}>Load more</MiniAppButton>
        </MiniAppToolbar>
      )}
    </MiniAppSection>
  );
}
