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

function ConfirmStopRetrying(props: {
  busy: boolean;
  mutating: boolean;
  onKeep: () => void;
  onStop: () => void;
}) {
  return (
    <>
      <p>
        Stopping retries will not undo a change that was already applied. Review
        current access before making another change.
      </p>
      <MiniAppActions>
        <MiniAppButton disabled={props.busy} onClick={props.onKeep}>
          Keep saved request
        </MiniAppButton>
        <MiniAppButton
          disabled={props.busy || props.mutating}
          onClick={props.onStop}
        >
          Stop retrying this change
        </MiniAppButton>
      </MiniAppActions>
    </>
  );
}

function PendingPolicyMutationActions(props: {
  busy: boolean;
  mutating: boolean;
  onRetry: () => void;
  onStopRetrying: () => void;
  unreadable: boolean;
}) {
  return (
    <MiniAppActions>
      {!props.unreadable && (
        <MiniAppButton
          disabled={props.busy || props.mutating}
          onClick={props.onRetry}
        >
          {props.busy ? "Resolving…" : "Retry saved change"}
        </MiniAppButton>
      )}
      <MiniAppButton
        disabled={props.busy || props.mutating}
        onClick={props.onStopRetrying}
      >
        Stop retrying…
      </MiniAppButton>
    </MiniAppActions>
  );
}

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
        <ConfirmStopRetrying
          busy={action.busy}
          mutating={props.mutating}
          onKeep={() => setConfirmedRequest(null)}
          onStop={() => {
            void action.run(true);
          }}
        />
      ) : (
        <PendingPolicyMutationActions
          busy={action.busy}
          mutating={props.mutating}
          onRetry={() => {
            void action.run(false);
          }}
          onStopRetrying={() => setConfirmedRequest(selected)}
          unreadable={Boolean(snapshot.unreadable)}
        />
      )}
    </section>
  );
}
