interface PricingTier {
  readonly name: string;
  readonly price: string;
  readonly description: string;
}

interface PricingTiersProps {
  readonly tiers: readonly PricingTier[];
}

export function PricingTiers({ tiers }: PricingTiersProps) {
  return (
    <ul aria-label="Pricing tiers" className="pricing-grid">
      {tiers.map((tier) => (
        <li className="pricing-tier" key={tier.name}>
          <h3 className="pricing-tier-name">{tier.name}</h3>
          <p className="pricing-tier-price">{tier.price}</p>
          <p className="pricing-tier-description">{tier.description}</p>
        </li>
      ))}
    </ul>
  );
}
