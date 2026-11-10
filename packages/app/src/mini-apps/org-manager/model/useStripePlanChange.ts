import { BILLING_ERROR_CODES } from "@tearleads/validators/billing";
import type { StripeSyncOptionResponse } from "@tearleads/validators/response";
import { useCallback, useEffect, useRef, useState } from "react";
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
 * Asks the server for the change. Returns the machine's answer and whether
 * the plans must be shown again: a refused change means the plans or the
 * current plan changed.
 */
async function requestPlanChange(input: {
  readonly changing: Extract<StripePlanChangeState, { kind: "changing" }>;
  readonly logError: (message: string, error: unknown) => void;
  readonly organizationId: string;
  readonly tearleads: ReturnType<typeof useTearleads>;
}): Promise<{
  readonly event: StripePlanChangeEvent;
  readonly reloadPlans: boolean;
}> {
  try {
    const change = await input.tearleads.organizations.changeStripePlan(
      input.changing.option.priceId,
      input.changing.fromSeatCount,
      input.organizationId,
    );
    return {
      event: change
        ? { type: "changed", change }
        : { type: "failed", error: PLAN_CHANGE_LABELS.failed },
      reloadPlans: false,
    };
  } catch (error) {
    const code = errorCode(error);
    const unavailable = code === BILLING_ERROR_CODES.planChangeUnavailable;
    if (!unavailable && code !== BILLING_ERROR_CODES.planChangePaymentFailed) {
      input.logError("Failed to change the Stripe plan", error);
    }
    return {
      event: { type: "failed", error: planChangeErrorMessage(error) },
      reloadPlans: unavailable,
    };
  }
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
  /** The active members the offered plans must cover, when known. */
  readonly rosterSeatCount: number | null;
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
  // A change's answer applies only to the switcher that asked: one for
  // another organization, or after it closed, is dropped.
  const generation = useRef(0);
  useEffect(() => {
    const opened = generation.current;
    return () => {
      generation.current = opened + 1;
    };
  }, [input.organizationId]);
  // The plans offered cover the roster; a roster that changed elsewhere
  // offers a different set, so they are read again.
  const shownRoster = useRef(input.rosterSeatCount);
  useEffect(() => {
    if (shownRoster.current !== input.rosterSeatCount) {
      shownRoster.current = input.rosterSeatCount;
      reload();
    }
  }, [input.rosterSeatCount, reload]);
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
    const request = generation.current;
    void requestPlanChange({ changing, logError, organizationId, tearleads })
      .then(async ({ event, reloadPlans }) => {
        // Dropped once the switcher closed or moved to another organization.
        if (generation.current !== request) {
          return;
        }
        if (reloadPlans) {
          reload();
        }
        send(event);
        if (event.type === "changed" || reloadPlans) {
          await refresh();
        }
      })
      .catch((error: unknown) => {
        logError("Failed to refresh billing after a plan change", error);
      });
  }, [logError, organizationId, refresh, reload, send, tearleads]);
  return { choose, confirm, dismiss, offer, retryOptions: reload, state };
}
