import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import { useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  usePendingPolicyMutation,
  usePendingPolicyMutationAction,
} from "./usePendingPolicyMutation";

export function PendingPolicyMutation(props: {
  organizationId: string;
  groups: readonly OrganizationGroupSummary[];
  refreshSignal: string | null;
  mutating: boolean;
  onResolved: () => void | Promise<void>;
}) {
  const snapshot = usePendingPolicyMutation(props);
  const action = usePendingPolicyMutationAction({ ...props, snapshot });
  const [confirmedRequest, setConfirmedRequest] = useState<
    typeof snapshot.pending | typeof snapshot.unreadable
  >(null);
  const pending = snapshot.pending;
  const selected = pending ?? snapshot.unreadable;
  const confirming = selected !== null && confirmedRequest === selected;
  const group = props.groups.find(
    (group) => group.groupId === pending?.groupId,
  );
  if (!selected)
    return snapshot.error ? (
      <MiniAppStatus tone="error">{snapshot.error}</MiniAppStatus>
    ) : null;
  return (
    <section aria-label="Saved access change">
      <strong>Saved access change</strong>
      {snapshot.unreadable && (
        <p>
          This saved request cannot be read or retried. You can explicitly
          discard the local request to continue.
        </p>
      )}
      <p>
        An earlier change{" "}
        {group?.name ? `for ${group.name}` : "in this organization"} may already
        have been applied. Resolve it before making another access change.
      </p>
      {snapshot.error && (
        <MiniAppStatus tone="error">{snapshot.error}</MiniAppStatus>
      )}
      {confirming ? (
        <>
          <p>
            Stopping retries will not undo a change that was already applied.
            Review current access before making another change.
          </p>
          <MiniAppActions>
            <MiniAppButton
              disabled={action.busy}
              onClick={() => setConfirmedRequest(null)}
            >
              Keep saved request
            </MiniAppButton>
            <MiniAppButton
              disabled={action.busy || props.mutating}
              onClick={() => {
                void action.run(true);
              }}
            >
              Stop retrying this change
            </MiniAppButton>
          </MiniAppActions>
        </>
      ) : (
        <MiniAppActions>
          {!snapshot.unreadable && (
            <MiniAppButton
              disabled={action.busy || props.mutating}
              onClick={() => {
                void action.run(false);
              }}
            >
              {action.busy ? "Resolving…" : "Retry saved change"}
            </MiniAppButton>
          )}
          <MiniAppButton
            disabled={action.busy || props.mutating}
            onClick={() => setConfirmedRequest(selected)}
          >
            Stop retrying…
          </MiniAppButton>
        </MiniAppActions>
      )}
    </section>
  );
}
