import { expect, test } from "bun:test";
import {
  CHECKOUT_OPTION_OFF,
  type CheckoutOptionEvent,
  type CheckoutOptionState,
  transitionCheckoutOption,
} from "./checkoutOptionMachine";

const option = {
  tierId: "solo" as const,
  seatLimit: 1,
  priceId: "price_sync",
  productName: "Sync",
  currency: "usd",
  unitAmount: 500,
  interval: "month",
  intervalCount: 1,
};
const loading: CheckoutOptionState = { status: "loading" };
const ready: CheckoutOptionState = { status: "ready", options: [option] };
const failed: CheckoutOptionState = { status: "failed", error: "x" };

const off: CheckoutOptionEvent = { type: "off" };
const load: CheckoutOptionEvent = { type: "load" };
const loaded: CheckoutOptionEvent = { type: "loaded", options: [option] };
const loadFailed: CheckoutOptionEvent = { type: "load-failed", error: "x" };

test.each<[CheckoutOptionState, CheckoutOptionEvent, CheckoutOptionState]>([
  [CHECKOUT_OPTION_OFF, load, loading],
  [loading, loaded, ready],
  [loading, loadFailed, failed],
  [loading, off, CHECKOUT_OPTION_OFF],
  // A reload withdraws the offer until it settles.
  [ready, load, loading],
  [failed, load, loading],
  [ready, off, CHECKOUT_OPTION_OFF],
  [failed, off, CHECKOUT_OPTION_OFF],
])("checkout option %o + %o -> %o", (state, event, next) => {
  expect(transitionCheckoutOption(state, event)).toEqual(next);
});

test.each<[CheckoutOptionState, CheckoutOptionEvent]>([
  [CHECKOUT_OPTION_OFF, off],
  [CHECKOUT_OPTION_OFF, loaded],
  [CHECKOUT_OPTION_OFF, loadFailed],
  [loading, load],
  // Only a load in flight can settle; nothing replaces a settled offer.
  [ready, loaded],
  [ready, loadFailed],
  [failed, loaded],
  [failed, loadFailed],
])("checkout option %o ignores %o", (state, event) => {
  expect(transitionCheckoutOption(state, event)).toBe(state);
});
