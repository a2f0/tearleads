# Changing plans

How an administrator moves an organization's paid subscription to a larger or
smaller plan, on the web through Stripe and in the native apps through the
App Store and Play. Tiers, capacity, and seats are described in
[RevenueCat billing](revenuecat-billing.md#fixed-tier-behavior).

An administrator changes the plan on every platform under the same rules:

| Change | Web (Stripe) | iOS (App Store) | Android (Play) |
| --- | --- | --- | --- |
| Upgrade | Prorated difference charged now; applies once paid | Prorated now; applies at once | Prorated now; applies at once |
| Billing date | Unchanged | Resets to the upgrade day | Unchanged |
| Downgrade | At renewal, no credit | At renewal, no credit | At renewal, no credit |
| Below the roster | Refused by the server (409) | Not offered | Not offered |
| Undo a scheduled downgrade | Choose the current plan | Store subscription settings | Store subscription settings |

- **Upgrade, web:** `POST /organizations/:id/billing/stripe/plan` switches the
  subscription item to the larger Price with
  `proration_behavior=always_invoice` and
  `payment_behavior=pending_if_incomplete`, so Stripe applies the new Price
  only once the prorated invoice is paid. Capacity, the seat event, and seats
  for waiting members follow only that payment. A declined card, or one
  needing authentication, leaves a `pending_update` whose open invoice is
  voided at once: nothing is charged later and the request returns 409
  `billing_plan_change_payment_failed`, so the admin updates the card from the
  website's Manage subscription page (the Stripe Billing Portal) and retries.
  An upgrade from a period whose smaller renewal plan was already written to
  Stripe first restores the paid Price without proration, so the charge
  covers only the difference from the plan paid for.
- **Upgrade, native:** StoreKit moves to a higher service level at once and
  prorates the old subscription; Play replaces the purchase with
  `CHARGE_PRORATED_PRICE`. Capacity follows the store's effective event
  ([native stores](./revenuecat-native-stores.md#product-and-organization-policy)),
  never the informational `PRODUCT_CHANGE`.
- **Downgrade, web:** the endpoint leases the Stripe seat row, lowers the
  item's Price with `proration_behavior=none`, and only then records the
  smaller plan as the renewal quantity (`desired_renewal_quantity`) and
  returns `scheduled`, so the answer means Stripe will renew at it: the
  renewal invoice charges the smaller Price and the current capacity stays
  until then. A Stripe write that fails or comes too late records nothing; a
  failed write may still apply in Stripe, so its lease stays behind and
  fences the row (see below), and the worker then writes back the recorded
  renewal plan's Price. A RevenueCat lifecycle event for the period already
  paid keeps that paid capacity even though the bound Price is the smaller
  one. Choosing the current plan again returns `kept` once its Price is
  restored, also without proration.
- **Downgrade, native:** App Store and Play (`DEFERRED`) both apply it at the
  next renewal.
- **Below the roster:** a plan smaller than the effective `Members` roster is
  refused until members are removed. On web the server refuses it with 409
  `billing_plan_change_unavailable`; the stores cannot be refused server-side,
  so native clients hide every tier below the active-member count in the
  billing snapshot.
- **Scheduled changes:** the billing snapshot's `pendingSeatCount` reports a
  scheduled smaller plan from either source, and the panel marks it
  Scheduled. If the roster grows past it, the scheduled plan stays as chosen
  and the panel says it cannot cover the roster; at renewal, members beyond
  its capacity have no seat.
- One web plan change runs at a time: an upgrade leases the Stripe seat row
  for five minutes while it is paid for, so the worker cannot write the Price
  meanwhile (an extension bound during it keeps the lease), and another
  change gets 409 `billing_plan_change_unavailable` until it ends. Stripe is
  charged only while at least half the lease remains; an upgrade that took
  longer is released unpaid with the same 409, so once a lease lapses the
  outcome in Stripe is final. Stripe renews only at the period's end, so any
  change within an hour of it waits with the same 409 until the renewal,
  keeping every Stripe write inside the paid period and leaving the worker
  time to write back the recorded renewal plan's Price after a lease lapses.
  A declined upgrade that first restored the paid Price over a scheduled
  smaller plan's writes the smaller Price back before answering. The larger
  renewal plan is recorded only once the upgrade is paid, so an upgrade that
  fails or never reaches Stripe leaves a scheduled smaller plan as it was.
- A change that never finished (a lost response, a failed final transaction,
  a Stripe write of unknown outcome) leaves its lapsed lease behind, and the
  lease fences the row: every newer change waits with 409 until the worker
  reconciles it from Stripe, ten minutes after the lease lapses, far longer
  than Stripe takes to apply a request already sent. So no choice is made
  against a Price that change may still be moving. A stalled upgrade that
  finishes meanwhile still holds the row and records its capacity and plan.
  When the worker reconciles it, finding Stripe at a larger Price than the
  capacity recorded for the period, it grants that capacity in the period
  the organization's billing tracks and records the larger plan as the
  renewal plan; otherwise it writes back the recorded renewal plan's Price.
  Every plan change also waits with 409 while the worker holds the row, so
  no renewal choice interleaves with that record. A Stripe webhook that binds
  the larger Price within the paid period first (the upgrade's own update,
  or an extension) records it as the renewal plan the same way. Until the
  capacity is recorded and granted, every plan change, which reads Stripe
  first, gets 409 `billing_plan_change_unavailable`: the worker would
  overwrite a newer renewal choice, and another plan would be priced from
  capacity not yet granted. An upgrade that finishes after the subscription
  renewed grants nothing to the new period, whose renewal invoice already
  charged the Price it renews at. That holds whichever provider reports the
  renewal first.
- Only a Stripe subscription that owns the organization's capacity (a priced
  binding, not one retained under native ownership) can change plan. Every
  change waits with 409 `billing_plan_change_unavailable` while Stripe has
  renewed into a period its webhooks have not bound yet, or while the
  organization's billing tracks another period than the one bound (one
  provider reported a renewal before the other), so an upgrade is always
  charged from, and a downgrade scheduled against, the period actually paid
  for. Two reports of a period are the same period when their starts differ
  by less than half its length; a billing period whose start is not known yet
  matches none, so the change waits until it is.
- Every request names the capacity the admin chose against
  (`currentSeatCount`). If the plan changed meanwhile (a renewal, another
  admin), the request gets 409 `billing_plan_change_unavailable`, so a choice
  shown as a change at renewal is never charged as an upgrade.
- A RevenueCat event within the paid period keeps the paid capacity; only an
  event that starts a later period grants the smaller renewal plan alone. An
  event belongs to the paid period unless it starts, or else ends, at least
  half a period after the bound start or end, so RevenueCat timestamps that
  trail Stripe's slightly never count as a renewal. The capacity is computed
  again under the billing lock before it is applied, so an upgrade paid after
  the event was read is not overwritten, and an event read before the bound
  Price changed is retried.
- An extension that moves the paid period's end but not its start keeps the
  capacity paid for it when Stripe's webhook binds the new end, even though
  the bound Price is already a scheduled smaller plan's. A period is
  identified by its start, so an upgrade paid while an extension is bound
  still applies.
- A web plan change is offered only where web checkout runs, never inside a
  store app.
