import { describeSchema } from "../jsonSchemaAnnotations";
import {
  ChallengeRequestSchema,
  RegistrationRequestSchema,
  RevenueCatIncomingWebhookEventSchema,
  RevenueCatSubscriberAttributeSchema,
  RevenueCatTransferWebhookEventSchema,
  RevenueCatWebhookEventSchema,
  RevenueCatWebhookRequestSchema,
  StripeCheckoutRequestSchema,
  StripeCheckoutSessionRequestSchema,
  StripeReturnUrlRequestSchema,
  VerifyRequestSchema,
} from "../request";
import {
  BillingErrorResponseSchema,
  ChallengeResponseSchema,
  DestroySessionResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  ListSessionsResponseSchema,
  OrganizationBillingHistoryEntrySchema,
  OrganizationBillingHistoryResponseSchema,
  OrganizationBillingManagementUrlResponseSchema,
  OrganizationBillingResponseSchema,
  OrganizationNativePurchaseEligibilityResponseSchema,
  PaymentRequiredErrorResponseSchema,
  RegistrationResponseSchema,
  RevenueCatWebhookResponseSchema,
  SessionFailureResponseSchema,
  StripeCancelResponseSchema,
  StripeCheckoutErrorResponseSchema,
  StripeCheckoutIntentResponseSchema,
  StripeCheckoutOptionsResponseSchema,
  StripeCheckoutSessionResponseSchema,
  StripePortalResponseSchema,
  StripeSyncOptionResponseSchema,
  StripeWebhookResponseSchema,
  UserIdentityResponseSchema,
  UserSessionResponseSchema,
  VerifyFailureResponseSchema,
  VerifySuccessResponseSchema,
  WebSocketTicketResponseSchema,
} from "../response";

describeSchema(
  ChallengeRequestSchema,
  "Asks for a sign-in challenge for a registered identity.",
  {
    fingerprint:
      "Lowercase hex SHA-256 fingerprint of the identity's ML-DSA-87 signing public key.",
  },
);

describeSchema(
  ChallengeResponseSchema,
  "A one-time sign-in challenge that the client signs and returns to `POST /auth/verify`.",
  {
    challenge:
      "Random hex challenge; it expires after a short time and can be verified once.",
  },
);

describeSchema(
  VerifyRequestSchema,
  "Proves possession of an identity's signing key by signing the sign-in challenge.",
  {
    fingerprint: "Fingerprint the challenge was issued for.",
    signature:
      "Base64 ML-DSA-87 signature over the challenge, bound to the API origin and fingerprint.",
  },
);

describeSchema(
  VerifySuccessResponseSchema,
  "A successful sign-in: the new session's bearer token and where the user's data starts.",
  {
    isRoot:
      "True for a platform operator; it only reveals the root console, and the API enforces root access itself.",
    organizationId: "The user's default organization.",
    rootContainerId:
      "Root container of the default organization, or null after that organization was purged; clients verify its role from signed state.",
    token: "Bearer token for the `Authorization` header of later requests.",
    wsTicket:
      "Single-use ticket for this session's first WebSocket connection.",
  },
);

describeSchema(VerifyFailureResponseSchema, "A refused sign-in.", {
  code: "`account_suspended` when the signature was valid but an operator suspended the account; treat it as terminal.",
});

describeSchema(
  RegistrationRequestSchema,
  "A new identity's public keys plus every signed artifact that bootstraps its personal organization, all created atomically.",
  {
    encapsulationPublicKey:
      "Base64 ML-KEM-1024 public key that key material is wrapped to.",
    signingPublicKey:
      "Base64 ML-DSA-87 public key that signs the identity's events and sign-in challenges.",
    initialSystemContainers:
      "The organization's other system containers, such as Trash, each with its metadata document.",
  },
);

describeSchema(
  RegistrationResponseSchema,
  "Acknowledges a registration by the ids and hashes of what it created, plus a sign-in challenge.",
  {
    challenge:
      "Sign-in challenge to sign and send to `POST /auth/verify`, so the new identity can sign in without another request.",
    committedCoreMetadataUpdateIds:
      "Ids of the seeded metadata updates the server committed with the provisioning.",
    committedProfileUpdateIds:
      "Ids of the seeded profile updates the server committed with the provisioning.",
    rootMetadataAccessEpoch:
      "Access epoch of the root container's metadata document.",
    rootMetadataAccessStateHash:
      "Access state hash of the root container's metadata document.",
  },
);

describeSchema(
  UserIdentityResponseSchema,
  "A user's registered public keys. Clients trust them only after matching an identity link or an existing identity pin.",
  {
    encapsulationKeyFingerprint:
      "SHA-256 fingerprint of `encapsulationPublicKey`.",
    encapsulationPublicKey: "Base64 ML-KEM-1024 public key.",
    signingKeyFingerprint: "SHA-256 fingerprint of `signingPublicKey`.",
    signingPublicKey: "Base64 ML-DSA-87 public key.",
  },
);

describeSchema(
  UserSessionResponseSchema,
  "One of the signed-in user's live sessions.",
  {
    id: "Session id, used to sign the session out.",
    ipAddresses: "IP addresses the session has been used from.",
    isCurrent: "True for the session that made this request.",
    signingKeyFingerprint:
      "Fingerprint of the signing key that opened the session.",
  },
);

describeSchema(
  ListSessionsResponseSchema,
  "The signed-in user's live sessions.",
);

describeSchema(
  DestroySessionResponseSchema,
  "Confirms that a session was signed out.",
);

describeSchema(
  WebSocketTicketResponseSchema,
  "A single-use ticket for one WebSocket connection to the realtime hint gateway.",
  {
    ticket:
      "Opaque ticket, passed in the WebSocket upgrade URL and deleted on first use.",
  },
);

describeSchema(
  SessionFailureResponseSchema,
  "A 401 from a route that needs a session.",
  {
    code: "`session_refresh_required` only when the server positively identified a stale or invalid session; other 401s carry no code.",
  },
);

describeSchema(
  ErrorResponseSchema,
  "The plain error envelope: a human-readable message for diagnostics, never for program decisions.",
);

describeSchema(HealthResponseSchema, "The health check answer.");

describeSchema(
  RevenueCatWebhookRequestSchema,
  "The envelope RevenueCat posts to the billing webhook.",
);

describeSchema(
  RevenueCatIncomingWebhookEventSchema,
  "A RevenueCat event: either a subscription lifecycle event or a receipt transfer.",
);

describeSchema(
  RevenueCatWebhookEventSchema,
  "A RevenueCat subscription lifecycle event, as far as organization billing reads it.",
  {
    id: "RevenueCat event id; a repeated delivery of the same id is a duplicate.",
    app_user_id:
      "RevenueCat App User ID, which is the Tearleads user id that made the purchase.",
    subscriber_attributes:
      "RevenueCat subscriber attributes; the server does not trust them to choose an organization.",
  },
);

describeSchema(
  RevenueCatTransferWebhookEventSchema,
  "A RevenueCat receipt transfer, which moves a store purchase between App User IDs.",
  {
    transferred_from: "App User IDs that held the purchase before.",
    transferred_to: "App User IDs that hold the purchase now.",
  },
);

describeSchema(
  RevenueCatSubscriberAttributeSchema,
  "One RevenueCat subscriber attribute; a cleared value is null.",
);

describeSchema(
  RevenueCatWebhookResponseSchema,
  "Acknowledges a RevenueCat delivery.",
  {
    outcome:
      "`applied` when billing changed, `duplicate` for an event id already handled, `ignored` when it needed no change.",
  },
);

describeSchema(StripeWebhookResponseSchema, "Acknowledges a Stripe delivery.", {
  outcome:
    "`associated` when a first paid invoice bound the subscription, `reconciled` when a renewal refreshed it, `ignored` otherwise.",
});

describeSchema(
  OrganizationBillingResponseSchema,
  "An organization's sync billing snapshot: whether it may sync, its plan period, and its seats.",
  {
    status:
      "Billing state; it decides whether the organization may sync at all. A `local` organization is free and syncs nothing.",
    activeMemberCount:
      "Members reachable through the signed `Members` group, as the server counts them.",
    assignedSeatCount:
      "Members who hold a sync seat; always the length of `assignedUserIds`.",
    assignedUserIds: "Members who may sync within the licensed seat count.",
    currentUserHasSyncSeat: "True when the caller holds one of the sync seats.",
    canCancelDirectly:
      "True when a Stripe subscription can be cancelled from the app, even while a native store owns billing.",
    subscriptionSource:
      "Store of record for the current or lapsed subscription, or null when nothing would conflict with a new purchase.",
    seatCount: "Licensed seats in the current paid period.",
    pendingSeatCount:
      "Seat count of a native plan change the store scheduled but has not applied yet.",
    disabledAt: "When sync stopped because billing lapsed.",
    purgeAfter:
      "When a disabled organization's synced data becomes eligible for purge.",
  },
);

describeSchema(
  OrganizationBillingHistoryEntrySchema,
  "One recorded billing event of an organization. Amounts are in the currency's minor unit as the provider reported them.",
  {
    seatDelta: "Change in seats this event caused; negative for a reduction.",
    unitAmount:
      "Price per billing period; for a recognized native grant, its canonical monthly USD list price.",
    totalAmount: "Amount actually charged, in `totalCurrency`.",
  },
);

describeSchema(
  OrganizationBillingHistoryResponseSchema,
  "An organization's billing events, newest first.",
);

describeSchema(
  OrganizationBillingManagementUrlResponseSchema,
  "Where an administrator manages a native store subscription.",
  {
    managementUrl:
      "App Store or Google Play management page, or null when there is no native subscription or the lookup failed.",
  },
);

describeSchema(
  OrganizationNativePurchaseEligibilityResponseSchema,
  "Whether the caller may start a native store purchase for the organization, and why not when refused.",
);

describeSchema(BillingErrorResponseSchema, "A refused billing request.", {
  code: "Machine-readable reason, such as an empty roster or a roster larger than any plan.",
});

describeSchema(
  PaymentRequiredErrorResponseSchema,
  "The 402 a sync write gets when its organization cannot sync.",
  {
    organizationId: "Organization whose billing refused the write.",
    reason:
      "`billing_inactive` when the organization has no active plan; `sync_seat_unassigned` when the caller holds no sync seat.",
  },
);

describeSchema(
  StripeSyncOptionResponseSchema,
  "One Stripe plan the organization can buy, shaped for the billing panel.",
  {
    seatLimit: "Most members the plan covers.",
    unitAmount:
      "Price in the currency's minor unit, or null when Stripe has no price.",
    intervalCount:
      "Number of intervals in one billing period, or null when Stripe omits it.",
  },
);

describeSchema(
  StripeCheckoutOptionsResponseSchema,
  "Every Stripe plan whose capacity covers the organization's current roster, smallest first.",
);

describeSchema(
  StripeCheckoutIntentResponseSchema,
  "The subscription started when the buyer pressed Pay, and what Stripe's Payment Element needs to confirm its first payment.",
  {
    clientSecret:
      "Stripe PaymentIntent client secret; pass it only to Stripe.js.",
  },
);

describeSchema(
  StripeCheckoutRequestSchema,
  "The plan the buyer chose when they pressed Pay.",
  {
    priceId:
      "Stripe Price id of the chosen plan, from the checkout options. The server charges only this Price and returns 409 `billing_checkout_plan_unavailable` when the roster has outgrown it.",
  },
);

describeSchema(StripeCheckoutErrorResponseSchema, "A refused checkout.", {
  code: "Machine-readable reason: an empty roster, a roster larger than any plan, or `billing_checkout_plan_unavailable` when the chosen plan is no longer offered.",
});

describeSchema(
  StripeCheckoutSessionResponseSchema,
  "A hosted Stripe Checkout page.",
  {
    url: "Checkout URL, or null when Stripe checkout is not configured.",
  },
);

describeSchema(StripePortalResponseSchema, "A Stripe customer portal page.", {
  portalUrl:
    "Portal URL, or null when Stripe is not configured or the organization has no live Stripe subscription.",
});

describeSchema(
  StripeCancelResponseSchema,
  "The result of cancelling a Stripe subscription at period end.",
  {
    cancelAt:
      "Unix time in seconds when sync ends, or null when the subscription was already cancelling.",
  },
);

describeSchema(
  StripeReturnUrlRequestSchema,
  "Where Stripe sends the browser back after a hosted flow.",
  {
    returnUrl:
      "Absolute HTTP(S) URL on one of the app origins the server allows.",
  },
);

describeSchema(
  StripeCheckoutSessionRequestSchema,
  "The plan the buyer chose for the hosted fallback, and where Stripe sends the browser back.",
  {
    priceId:
      "Stripe Price id of the chosen plan, from the checkout options. A plan the roster has outgrown gets 409 `billing_checkout_plan_unavailable`.",
    returnUrl:
      "Absolute HTTP(S) URL on one of the app origins the server allows.",
  },
);
