import type { NativeSubscriptionStore } from "@tearleads/validators/billing";
import {
  cancelStripeSubscriptionOperation,
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

  /** Starts or resumes inline checkout; an existing subscription returns 409. */
  createStripeCheckout(organizationId: string) {
    return this.context.send(
      checkout.checkout,
      checkout.checkout.path(organizationId),
      createStripeCheckoutOperation,
    );
  }

  /** Opens hosted checkout; a null URL means unavailable or ineligible. */
  createStripeCheckoutSession(organizationId: string, returnUrl: string) {
    return this.context.send(
      checkout.checkoutSession,
      checkout.checkoutSession.path(organizationId),
      createStripeCheckoutSessionOperation,
      checkout.checkoutSession.body(returnUrl),
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

  startOrganizationTrial(organizationId: string) {
    return this.context.send(
      organizationBilling.startTrial,
      organizationBilling.startTrial.path(organizationId),
      startOrganizationTrialOperation,
    );
  }
}
