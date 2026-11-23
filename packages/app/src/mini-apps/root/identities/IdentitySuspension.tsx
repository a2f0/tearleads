import { ProhibitIcon } from "@phosphor-icons/react/dist/csr/Prohibit";
import { UserCheckIcon } from "@phosphor-icons/react/dist/csr/UserCheck";
import type { RootIdentity } from "@tearleads/client-sdk";
import { useWindowTitleBarAction } from "@tearleads/windowing";
import {
  type FormEvent,
  type ReactElement,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import {
  IDLE_SUSPENSION,
  type IdentitySuspensionEvent,
  type SuspensionChange,
  transitionIdentitySuspension,
} from "./identitySuspensionMachine";
import { describeRootFailure, describeThrown } from "./rootDisplay";

// Module-level so an unchanged action matches its registration structurally.
interface SuspensionAction {
  /** What the action reads while it runs, when that differs. */
  readonly busyLabel?: string;
  readonly icon: ReactElement;
  readonly id: string;
  readonly label: string;
}
// A lift has no dialog, so its label says it is running; a suspension's
// confirmation dialog reads "Suspending..." instead.
const LIFT_ACTION: SuspensionAction = {
  busyLabel: "Lifting...",
  icon: <UserCheckIcon aria-hidden size={18} />,
  id: "root-lift-suspension",
  label: "Lift suspension",
};
const SUSPEND_ACTION: SuspensionAction = {
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
 * The suspension machine, with a `send` that returns the state it entered, so
 * a caller can tell whether its own request started even when two clicks land
 * before a render.
 */
function useIdentitySuspensionMachine() {
  const machine = useRef(IDLE_SUSPENSION);
  const [state, setState] = useState(IDLE_SUSPENSION);
  const send = useCallback((event: IdentitySuspensionEvent) => {
    machine.current = transitionIdentitySuspension(machine.current, event);
    setState(machine.current);
    return machine.current;
  }, []);
  return [state, send] as const;
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
  const [state, send] = useIdentitySuspensionMachine();
  const suspended = identity.suspendedAt !== null;
  const running = state.status === "running" ? state.change : null;

  const run = async (change: SuspensionChange) => {
    const request = Symbol(change);
    const entered = send({ change, request, type: "start" });
    if (entered.status !== "running" || entered.request !== request) return;
    let error: string | null = null;
    try {
      const outcome =
        change === "suspend"
          ? await tearleads.root.suspendIdentity(identity.userId)
          : await tearleads.root.liftIdentitySuspension(identity.userId);
      if (outcome.ok) onChanged();
      else error = describeRootFailure(outcome);
    } catch (thrown) {
      error = describeThrown(thrown);
    }
    send({ error, request, type: "settle" });
  };

  const action = suspended ? LIFT_ACTION : SUSPEND_ACTION;
  useWindowTitleBarAction(
    identity.isRoot && !suspended
      ? null
      : {
          disabled: running !== null,
          icon: action.icon,
          id: action.id,
          label: running ? (action.busyLabel ?? action.label) : action.label,
          onClick: suspended
            ? () => void run("lift")
            : () => send({ type: "ask-to-suspend" }),
          priority: 110,
        },
  );

  // A suspension keeps its dialog open, reading "Suspending...", while it runs.
  const confirming = state.status === "confirming" || running === "suspend";
  return (
    <>
      {state.status !== "running" && state.error && (
        <MiniAppStatus tone="error">{state.error}</MiniAppStatus>
      )}
      {confirming && (
        <SuspendConfirmationDialog
          busy={running !== null}
          onCancel={() => send({ type: "cancel" })}
          onConfirm={() => void run("suspend")}
        />
      )}
    </>
  );
}
