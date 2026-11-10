import { BILLING_ERROR_CODES } from "@tearleads/validators/billing";
import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import { useCallback, useRef, useState } from "react";
import { useLog } from "../../../providers/logging/LogProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import {
  PLAN_CHANGE_LABELS,
  planChangeErrorMessage,
} from "../billing/checkoutCopy";
import { useCheckoutOption } from "../billing/useDirectCheckout";
import type { CheckoutOptionState } from "./checkoutOptionMachine";
import {
  IDLE_STRIPE_PLAN_CHANGE,
  type StripePlanChangeEvent,
  type StripePlanChangeState,
  stripePlanDirection,
  transitionStripePlanChange,
} from "./stripePlanChangeMachine";

/** The plan switcher for an organization's active Stripe subscription. */
export interface StripePlanChangeFlow {
  /** The plans that cover the roster, as for checkout. */
  readonly offer: CheckoutOptionState;
  readonly state: StripePlanChangeState;
  readonly choose: (option: StripeSyncOptionResponse) => void;
  readonly confirm: () => void;
  readonly dismiss: () => void;
  readonly retryOptions: () => void;
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

/**
 * Runs `model/stripePlanChangeMachine.ts`: the admin chooses a plan, confirms
 * it, and the server charges an upgrade now or schedules a downgrade for
 * renewal. The ref is the machine, so a second Confirm before React
 * re-renders cannot start a second change. After a change the billing
 * snapshot is refreshed; a plan the server refused reloads the plans.
 */
export function useStripePlanChange(input: {
  readonly organizationId: string;
  readonly refresh: () => Promise<void>;
  /** The paid capacity the switcher shows the plans against. */
  readonly seatCount: number;
}): StripePlanChangeFlow {
  const tearleads = useTearleads();
  const { logError } = useLog();
  const { offer, reload } = useCheckoutOption(
    true,
    true,
    true,
    input.organizationId,
    tearleads,
  );
  const [state, setState] = useState(IDLE_STRIPE_PLAN_CHANGE);
  const machine = useRef(state);
  const send = useCallback((event: StripePlanChangeEvent) => {
    const next = transitionStripePlanChange(machine.current, event);
    machine.current = next;
    setState(next);
    return next;
  }, []);
  const { organizationId, refresh, seatCount } = input;
  const choose = useCallback(
    (option: StripeSyncOptionResponse) => {
      send({
        type: "choose",
        direction: stripePlanDirection(option, seatCount),
        fromSeatCount: seatCount,
        option,
      });
    },
    [send, seatCount],
  );
  const dismiss = useCallback(() => {
    send({ type: "dismiss" });
  }, [send]);
  const confirm = useCallback(() => {
    const before = machine.current;
    const changing = send({ type: "confirm" });
    // Only the confirmation that entered `changing` starts the change; a
    // second click before React re-renders finds it already changing.
    if (before.kind !== "confirming" || changing.kind !== "changing") {
      return;
    }
    void (async () => {
      try {
        const change = await tearleads.organizations.changeStripePlan(
          changing.option.priceId,
          changing.fromSeatCount,
          organizationId,
        );
        if (!change) {
          send({ type: "failed", error: PLAN_CHANGE_LABELS.failed });
          return;
        }
        send({ type: "changed", change });
        await refresh();
      } catch (error) {
        const code = errorCode(error);
        if (code === BILLING_ERROR_CODES.planChangeUnavailable) {
          // The plans or the current plan changed: show them again.
          reload();
          void refresh();
        } else if (code !== BILLING_ERROR_CODES.planChangePaymentFailed) {
          logError("Failed to change the Stripe plan", error);
        }
        send({ type: "failed", error: planChangeErrorMessage(error) });
      }
    })();
  }, [logError, organizationId, refresh, reload, send, tearleads]);
  return { choose, confirm, dismiss, offer, retryOptions: reload, state };
}
