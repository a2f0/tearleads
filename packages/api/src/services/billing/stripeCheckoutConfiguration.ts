import {
  isRevenueCatAssociationConfigured,
  type RevenueCatAssociationDeps,
} from "../../billing/revenueCatStripeAssociation";
import {
  isStripeCheckoutConfigured,
  type StripeApiDeps,
} from "../../billing/stripeApi";
import { readStripeWebhookSecret } from "../../billing/stripeWebhook";

export interface StripeCheckoutServiceDeps {
  readonly stripe?: StripeApiDeps;
  readonly revenueCat?: RevenueCatAssociationDeps;
}

export function isDirectCheckoutFullyConfigured(
  deps: StripeCheckoutServiceDeps,
): boolean {
  const stripeEnv = deps.stripe?.env ?? process.env;
  const revenueCatEnv = deps.revenueCat?.env ?? process.env;
  return (
    isStripeCheckoutConfigured(deps.stripe ?? {}) &&
    readStripeWebhookSecret(stripeEnv) !== null &&
    isRevenueCatAssociationConfigured(revenueCatEnv)
  );
}
