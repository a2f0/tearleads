# Billing History

`GET /organizations/:id/billing/history` is admin-only and combines three
durable record categories: RevenueCat lifecycle events, the internal
licensed-seat ledger, and append-only Stripe paid-invoice snapshots.

Stripe invoice totals preserve the provider's exact `amount_paid` in currency
minor units. Seat quantity, per-seat rate, recurring interval and interval
count, price, and billing period come from the matching non-proration invoice
line—not mutable current subscription state—so delayed webhooks cannot rewrite
older charges. Creation and cycle invoices use a pinned-API lookup when the
signed webhook's line details are incomplete or could be enriched; only those
reasons advance seat-period state. Paid subscription update and threshold
invoices are audited too, but they never make fulfillment retry solely for
missing reporting details.

If an invoice has no unambiguous recurring seat line (for example, a
proration-only update), its exact total is still recorded while seat and rate
fields stay `null`. The same total-only fallback applies when Stripe's complete
line list cannot be resolved, so reporting detail never strands a paid seat
period. An initial purchase without an invoice id still fulfills from its
authoritative subscription binding without fabricating an audit row; an id-less
renewal is acknowledged without changing the renewal baseline.

Fields unavailable from the provider, or not applicable to a category, stay
`null` instead of being reconstructed. Incomplete paid-invoice deliveries are
retried when creation or renewal fulfillment depends on them. Other billing
reasons preserve an exact total-only snapshot when their signed invoice-level
facts are available, without paginating a potentially large line history.
If those core facts are absent but the invoice id is present, one pinned
resolution attempt recovers them; a definitive 404 is acknowledged, while
transient provider failures remain retryable.

The first snapshot for an invoice id remains immutable. A redelivery whose
organization, subscription, billing reason, currency, or paid total changes is
treated as a hard conflict. Differences limited to line attribution or event
metadata preserve the first snapshot while allowing idempotent seat and
RevenueCat fulfillment to finish after a downstream partial failure.

Never derive an invoice total from seats multiplied by unit price. The paid
total can include prorations, taxes, discounts, credits, and other adjustments;
only the recorded provider amount is authoritative.
