import type { RootIdentity } from "@tearleads/client-sdk";
import { type FormEvent, useId, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../../components/mini-app/MiniAppLayout";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { describeRootFailure, describeThrown } from "./rootDisplay";

function SuspendConfirmationDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const messageId = useId();
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!busy) {
      onConfirm();
    }
  };

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id={titleId}>Suspend account?</h2>
          <MiniAppStatus id={messageId} tone="error">
            This signs the account out of every device and blocks sign-in until
            the suspension is lifted. Its data is untouched.
          </MiniAppStatus>
          <MiniAppActions>
            <MiniAppButton disabled={busy} onClick={onCancel} type="button">
              Cancel
            </MiniAppButton>
            <MiniAppButton disabled={busy} type="submit">
              {busy ? "Suspending..." : "Suspend"}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}

/**
 * Suspend and lift controls. A root identity, the operator's own among them,
 * is never offered suspension, which the server refuses anyway. One granted
 * root while suspended keeps the lift control, since granting root does not
 * lift a suspension.
 */
export function IdentitySuspension({
  identity,
  onChanged,
}: {
  identity: RootIdentity;
  onChanged: () => void;
}) {
  const tearleads = useTearleads();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (identity.isRoot && !identity.suspendedAt) {
    return null;
  }

  const run = async (change: "lift" | "suspend") => {
    setBusy(true);
    setError(null);
    try {
      const outcome =
        change === "suspend"
          ? await tearleads.root.suspendIdentity(identity.userId)
          : await tearleads.root.liftIdentitySuspension(identity.userId);
      if (!outcome.ok) {
        setError(describeRootFailure(outcome));
        return;
      }
      onChanged();
    } catch (thrown) {
      setError(describeThrown(thrown));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <MiniAppToolbar>
        {identity.suspendedAt ? (
          <MiniAppButton disabled={busy} onClick={() => void run("lift")}>
            {busy ? "Lifting..." : "Lift suspension"}
          </MiniAppButton>
        ) : (
          <MiniAppButton disabled={busy} onClick={() => setConfirming(true)}>
            Suspend account
          </MiniAppButton>
        )}
      </MiniAppToolbar>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      {confirming && (
        <SuspendConfirmationDialog
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void run("suspend")}
        />
      )}
    </>
  );
}
