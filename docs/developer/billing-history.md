# Billing History

`GET /organizations/:id/billing/history` is admin-only and combines three
durable record categories: RevenueCat lifecycle events, the internal
licensed-seat ledger, and append-only Stripe paid-invoice snapshots.

Stripe invoice totals preserve the provider's exact `amount_paid` in currency
minor units. Seat quantity, per-seat rate, recurring interval and interval
count, price, and billing period come from the matching non-proration invoice
line—not mutable current subscription state—so delayed webhooks cannot rewrite
older charges. The line list must be explicitly complete before a snapshot is
accepted. Paid subscription update and threshold invoices are audited too; only
creation and cycle invoices advance seat-period state.

If an invoice has no unambiguous recurring seat line (for example, a
proration-only update), its exact total is still recorded while seat and rate
fields stay `null`.

Fields not captured for legacy records, or not applicable to a category, stay
`null` instead of being reconstructed. Incomplete paid-invoice deliveries are
retried, using a pinned-API invoice lookup when possible, before an append-only
snapshot is accepted.

Never derive an invoice total from seats multiplied by unit price. The paid
total can include prorations, taxes, discounts, credits, and other adjustments;
only the recorded provider amount is authoritative.
