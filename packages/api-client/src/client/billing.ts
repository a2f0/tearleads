import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import {
  cancelStripeSubscriptionOperation,
  changeStripePlanOperation,
  claimNativeOrganizationSubscriptionOperation,
  createStripeCheckoutOperation,
  createStripeCheckoutSessionOperation,
  createStripePortalOperation,
  getOrganizationBillingHistoryOperation,
  getOrganizationBillingManagementUrlOperation,
  getOrganizationBillingOperation,
  getOrganizationNativePurchaseEligibilityOperation,
  getStripeCheckoutOptionsOperation,
  startOrganizationTrialOperation,
} from "@tearleads/validators/operation";
import { bindPrototypeMethods } from "../requestInternals";
import { organizationBilling } from "../routes/organizations/billing";
import { organizationStripeCheckout } from "../routes/organizations/stripeCheckout";
import type { RequestResultOptions } from "../types";
import type { ApiClientContext } from "./apiClientContext";

const checkout = organizationStripeCheckout;

/** Organization billing state, native store claims, and Stripe checkout. */
export class BillingArea {
  constructor(private readonly context: ApiClientContext) {
    bindPrototypeMethods(this, BillingArea.prototype);
  }

  getOrganizationBilling(organizationId: string) {
    return this.context.send(
      organizationBilling.get,
      organizationBilling.get.path(organizationId),
      getOrganizationBillingOperation,
    );
  }

  getOrganizationBillingHistory(organizationId: string) {
    return this.context.send(
      organizationBilling.history,
      organizationBilling.history.path(organizationId),
      getOrganizationBillingHistoryOperation,
    );
  }

  getOrganizationBillingManagementUrl(organizationId: string) {
    return this.context.send(
      organizationBilling.managementUrl,
      organizationBilling.managementUrl.path(organizationId),
      getOrganizationBillingManagementUrlOperation,
    );
  }

  getOrganizationNativePurchaseEligibility(
    organizationId: string,
    store: NativeSubscriptionStore,
  ) {
    return this.context.send(
      organizationBilling.nativeEligibility,
      organizationBilling.nativeEligibility.path(organizationId, store),
      getOrganizationNativePurchaseEligibilityOperation,
    );
  }

  claimNativeOrganizationSubscription(
    organizationId: string,
    store: NativeSubscriptionStore,
  ) {
    return this.context.sendResult(
      organizationBilling.nativeClaim,
      organizationBilling.nativeClaim.path(organizationId, store),
      claimNativeOrganizationSubscriptionOperation,
      undefined,
      { reportErrors: false },
    );
  }

  /** Empty options means unconfigured; 403/409 remain errors. */
  getStripeCheckoutOptions(
    organizationId: string,
    options: RequestResultOptions = {},
  ) {
    return this.context.sendResult(
      checkout.options,
      checkout.options.path(organizationId),
      getStripeCheckoutOptionsOperation,
      undefined,
      options,
    );
  }

  /**
   * Starts (or resumes) the inline subscription when the buyer presses Pay,
   * at the plan they chose. A plan that is no longer offered or an existing
   * subscription is a 409 with a billing code.
   */
  createStripeCheckout(
    organizationId: string,
    priceId: string,
    options: RequestResultOptions = {},
  ) {
    return this.context.sendResult(
      checkout.checkout,
      checkout.checkout.path(organizationId),
      createStripeCheckoutOperation,
      checkout.checkout.body(priceId),
      options,
    );
  }

  /**
   * Opens hosted checkout for the chosen plan. A refused plan is a 409 with a
   * billing code; an unconfigured integration is a null URL.
   */
  createStripeCheckoutSession(
    organizationId: string,
    priceId: string,
    returnUrl: string,
    options: RequestResultOptions = {},
  ) {
    return this.context.sendResult(
      checkout.checkoutSession,
      checkout.checkoutSession.path(organizationId),
      createStripeCheckoutSessionOperation,
      checkout.checkoutSession.body(priceId, returnUrl),
      options,
    );
  }

  /** Opens Stripe's subscription-management portal for the organization. */
  createStripePortal(organizationId: string, returnUrl: string) {
    return this.context.send(
      checkout.portal,
      checkout.portal.path(organizationId),
      createStripePortalOperation,
      checkout.portal.body(returnUrl),
    );
  }

  /** Schedules period-end cancellation; any non-2xx resolves null. */
  cancelStripeSubscription(organizationId: string) {
    return this.context.send(
      checkout.cancel,
      checkout.cancel.path(organizationId),
      cancelStripeSubscriptionOperation,
    );
  }

  /**
   * Changes the active Stripe subscription's plan from the one at
   * `currentSeatCount`: a larger plan is charged now, a smaller one is
   * scheduled for renewal. A refused change, including one whose current plan
   * changed meanwhile, is a 409 with a billing code; an unconfigured
   * integration is a 503.
   */
  changeStripePlan(
    organizationId: string,
    priceId: string,
    currentSeatCount: number,
    options: RequestResultOptions = {},
  ) {
    return this.context.sendResult(
      checkout.plan,
      checkout.plan.path(organizationId),
      changeStripePlanOperation,
      checkout.plan.body(priceId, currentSeatCount),
      options,
    );
  }

  startOrganizationTrial(organizationId: string) {
    return this.context.send(
      organizationBilling.startTrial,
      organizationBilling.startTrial.path(organizationId),
      startOrganizationTrialOperation,
    );
  }
}
