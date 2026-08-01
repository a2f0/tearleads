# Payment Provider MCP and CLI Operations

This is the shared operator guide for provisioning and auditing the Tearleads
billing catalog. The implementation contract lives in
[revenuecat-billing.md](./revenuecat-billing.md); this document explains which
provider tools an agent can use and which account-owner steps remain outside
those tools.

The system is greenfield. Do not add migration, receipt-rebinding, or legacy
catalog work unless real subscribers exist when the change is made.

## Product invariant

- A personal organization may subscribe in a native app. Apple or Google is the
  store of record and RevenueCat mirrors the `sync` entitlement.
- A custom organization subscribes on the web. Stripe is the store of record and
  RevenueCat mirrors the same entitlement.
- Native stores use fixed products, never Stripe-style quantity. Stripe also
  uses the same fixed tiers with subscription-item quantity `1`.
- Cancellation is routed to the store of record. Either client can open the
  provider management surface, and either client can call the Tearleads Stripe
  cancellation endpoint. Provider webhooks keep server access in sync.

| Tier | USD/month | Capacity | Product stem | RevenueCat package | Apple level |
| --- | ---: | ---: | --- | --- | ---: |
| Solo | $5 | 1 | `sync_solo_monthly` | `solo` | 3 |
| Team 5 | $10 | 5 | `sync_team_5_monthly` | `team_5` | 2 |
| Team 10 | $20 | 10 | `sync_team_10_monthly` | `team_10` | 1 |

Staging Apple and Google product IDs append `_staging`. Google appends the
`monthly` base-plan ID when the product is represented in RevenueCat, for
example `sync_solo_monthly_staging:monthly`.

## Codex MCP setup

Stripe and RevenueCat both publish first-party remote MCP servers. MCP
registration is user-scoped Codex configuration, not repository configuration,
so every agent must check its own environment instead of assuming that the
servers are authenticated.

```sh
codex mcp add stripe --url https://mcp.stripe.com
codex mcp login stripe

codex mcp add revenuecat --url https://mcp.revenuecat.ai/mcp
codex mcp login revenuecat

codex mcp get stripe
codex mcp get revenuecat
```

The browser OAuth flow is preferred. It avoids copying provider secrets into
Codex configuration and gives the provider a revocable authorization grant. A
new Codex session may be required before newly registered tools appear.

Both servers also accept bearer tokens. Use this only for a noninteractive
environment that injects a dedicated, least-privilege credential before Codex
starts. Never put the token value in `~/.codex/config.toml` or commit it.

```sh
codex mcp remove revenuecat
codex mcp add revenuecat \
  --url https://mcp.revenuecat.ai/mcp \
  --bearer-token-env-var TEARLEADS_REVENUECAT_MCP_TOKEN

codex mcp remove stripe
codex mcp add stripe \
  --url https://mcp.stripe.com \
  --bearer-token-env-var TEARLEADS_STRIPE_MCP_RESTRICTED_KEY
```

The environment variable must be present in the process that launches Codex.
Prefer separate read-only audit credentials and write-enabled provisioning
credentials. These must be dedicated MCP credentials, not aliases for deployed
API credentials such as `REVENUECAT_V2_SECRET_KEY` or `STRIPE_SECRET_KEY`.
RevenueCat documents the exact API v2 permissions required by each operation;
Stripe restricted keys should enable only the resources the agent will manage.

Official references:

- [Stripe MCP server](https://docs.stripe.com/mcp)
- [RevenueCat MCP setup](https://www.revenuecat.com/docs/tools/mcp/setup)
- [RevenueCat API v2](https://www.revenuecat.com/docs/api-v2)

### Verified MCP capability boundaries

- Stripe MCP can audit account readiness and reconcile live or test Products,
  Prices, and webhook endpoints. It does not expose the account's secret or
  publishable API keys, and it cannot accept Terms of Service or choose legal,
  identity, contact, or payout information. Before live provisioning, verify
  `charges_enabled`, `payouts_enabled`, `details_submitted`, and the account
  requirements; after creating a webhook, store its returned signing secret in
  the matching tier environment without printing it.
- RevenueCat MCP can configure Test Store prices with
  `create_product_prices`; amounts are currency micros (`5000000` = USD $5).
  Read the prices back with `list_prices`, then verify the product remains
  attached to both its fixed-tier package and the `sync` entitlement.
- RevenueCat may omit production `strp_…` and `rcb_…` public keys while the
  connected Stripe account is not activated for live charges. Re-list the app
  public API keys after Stripe activation instead of copying sandbox keys into
  production. If they remain absent, re-saving the app's Stripe account ID
  through API v2 is not a substitute for reconnecting: the RevenueCat project
  owner must complete the live Stripe OAuth connection in the dashboard and
  select it on each production web config. The MCP and public API do not expose
  that owner-only flow; follow RevenueCat's
  [Stripe connection guide](https://www.revenuecat.com/docs/web/connect-stripe-account).

## CLI and API fallbacks

The MCPs cover Stripe and RevenueCat well. Apple and Google currently need API
or CLI tooling.

| Provider | Preferred automation | Existing API/CLI credential source | Notes |
| --- | --- | --- | --- |
| Stripe | Stripe MCP; Stripe CLI | `.secrets/root.env` plus the tier env | Prefer OAuth for MCP. `brew install stripe-cli`; use test mode until live credentials are explicitly selected. |
| RevenueCat | RevenueCat MCP; API v2 | `REVENUECAT_V2_SECRET_KEY` and `REVENUECAT_PROJECT_ID` | Prefer OAuth for MCP. There is no separate RevenueCat CLI requirement. |
| Apple | App Store Connect API; `asc` CLI | `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, and `.secrets/AuthKey_<id>.p8` | `brew install asc`; `asc` is community maintained, while the underlying API is Apple-supported. |
| Google | Android Publisher API | `.secrets/google-play-service-account.json` | `gcloud` manages Cloud/API bootstrap but not the Play subscription catalog. The pinned Fastlane Google client can read and write Android Publisher resources when its Play permissions allow it. |

Configure `asc` without copying a private key into its own profile:

```sh
export ASC_KEY_ID="$APP_STORE_CONNECT_KEY_ID"
export ASC_ISSUER_ID="$APP_STORE_CONNECT_ISSUER_ID"
export ASC_PRIVATE_KEY_PATH=".secrets/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8"
asc auth status --validate
```

Useful read-only store checks already live in the repository:

```sh
bun run --cwd packages/app-capacitor store:build-numbers
bun run --cwd packages/app-capacitor store:build-numbers:staging
```

References:

- [Stripe CLI](https://docs.stripe.com/stripe-cli)
- [App Store Connect subscription API](https://developer.apple.com/documentation/appstoreconnectapi/managing-auto-renewable-subscriptions)
- [`asc` CLI](https://docs.asccli.sh/commands/subscriptions)
- [Google Play subscriptions API](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.subscriptions)
- [Google Play Developer API access](https://developers.google.com/android-publisher/getting_started)

## Agent workflow

Treat provider configuration as a declarative reconciliation job:

1. Read the repository contract and target tier secrets. Never print secret
   values, private keys, webhook authorization headers, or management URLs.
2. Audit the current provider resources before writing. Match immutable product
   identifiers and exact Stripe mode, not display names alone.
3. Produce the intended diff. A production write requires an explicit live-mode
   credential and must never reuse the root test Stripe key.
4. Reconcile in this order: store apps and credentials; Apple/Google products;
   Stripe Product and Prices; RevenueCat products, entitlement, offering,
   packages, and webhooks; deployed environment variables.
5. Verify product price, period, capacity metadata, package attachment,
   entitlement attachment, webhook target, and environment after each write.
6. Deploy the API through Ansible before clients. This renders billing secrets
   and installs/enables the Stripe seat-sync timer.
7. Test purchase, tier change, cancellation, expiration, restore, and webhook
   redelivery in staging before enabling live checkout.

Provider resources often cannot be renamed or their identifiers reused. Never
delete or archive a product as an incidental cleanup. In a truly greenfield
account, confirm that no receipt or subscriber exists before removing a legacy
resource.

## Required provider shape

Stripe needs one `Sync` Product and three monthly recurring Prices. All checkout
items use quantity `1`; the Prices carry tier/capacity metadata. Register the
staging and production `/billing/stripe/webhook` endpoints for `invoice.paid`,
using a different signing secret for each endpoint.

RevenueCat needs:

- one `sync` entitlement;
- one current `default` offering;
- `solo`, `team_5`, and `team_10` packages;
- the matching Test Store, production iOS/Android, and staging iOS/Android
  product attached to both its package and `sync`;
- the connected Stripe Product attached to `sync`;
- staging and production `/billing/revenuecat/webhook` integrations with the
  repository authorization header.

Each Apple app needs one subscription group, three one-month products at levels
3/2/1, localized metadata, prices, territory availability, a review screenshot,
and review submission. Each Google app needs three subscriptions with an active
`monthly` auto-renewing base plan and the matching localized price.

## Account-specific handoff

Volatile provider state, resource identifiers, local authentication status, and
pending account-owner actions live in the git-ignored
`.secrets/revenuecat.md`, as described in
[revenuecat-billing.md](./revenuecat-billing.md). An agent working in an
authorized checkout must read that handoff, perform a fresh read-only provider
audit, and update it after provisioning. Do not copy its account snapshot into
tracked documentation.

MCP registration and OAuth authorization are user-scoped. Check the current
machine with `codex mcp list` and `codex mcp get <name>`; never infer local
authentication from this repository. If the ignored handoff is unavailable,
reconstruct provider state through read-only APIs before making changes.
