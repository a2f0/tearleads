export function activeStripePrice(id: string, unitAmount: number) {
  return {
    active: true,
    currency: "usd",
    id,
    product: { active: true, id: "prod_sync" },
    recurring: { interval: "month", interval_count: 1 },
    unit_amount: unitAmount,
  };
}
