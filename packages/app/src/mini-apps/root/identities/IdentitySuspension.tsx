import { ProhibitIcon } from "@phosphor-icons/react/dist/csr/Prohibit";
import { UserCheckIcon } from "@phosphor-icons/react/dist/csr/UserCheck";
import type { RootIdentity } from "@tearleads/client-sdk";
import { useWindowTitleBarAction } from "@tearleads/windowing";
import { type FormEvent, useId, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import { describeRootFailure, describeThrown } from "./rootDisplay";

// Module-level so an unchanged action matches its registration structurally.
// A lift has no dialog, so its label says it is running; a suspension's
// confirmation dialog reads "Suspending..." instead.
const LIFT_ACTION = {
  busyLabel: "Lifting...",
  icon: <UserCheckIcon aria-hidden size={18} />,
  id: "root-lift-suspension",
  label: "Lift suspension",
};
const SUSPEND_ACTION = {
  busyLabel: "Suspend account",
  icon: <ProhibitIcon aria-hidden size={18} />,
  id: "root-suspend-identity",
  label: "Suspend account",
};

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
 * Suspend and lift, as a window toolbar action beside Audit activity; the
 * confirmation and any failure render in the view. A root identity, the
 * operator's own among them, is never offered suspension, which the server
 * refuses anyway. One granted root while suspended keeps the lift action,
 * since granting root does not lift a suspension.
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
  const suspended = identity.suspendedAt !== null;

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

  const action = suspended ? LIFT_ACTION : SUSPEND_ACTION;
  useWindowTitleBarAction(
    identity.isRoot && !suspended
      ? null
      : {
          disabled: busy,
          icon: action.icon,
          id: action.id,
          label: busy ? action.busyLabel : action.label,
          onClick: suspended
            ? () => void run("lift")
            : () => setConfirming(true),
          priority: 110,
        },
  );

  return (
    <>
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
