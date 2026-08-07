export const revenueCatWebhookAuthorizationRefinement = {
  description:
    "Authorization must match the configured RevenueCat webhook secret in constant time",
  id: "request.revenuecat-webhook-authorization",
} as const;

export const stripeWebhookSignatureRefinement = {
  description:
    "Stripe-Signature must authenticate the exact raw request body within the replay tolerance",
  id: "request.stripe-webhook-signature",
} as const;
