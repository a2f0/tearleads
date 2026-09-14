interface PricingTier {
  readonly name: string;
  readonly price: string;
  readonly interval: string;
  readonly description: string;
  readonly capacity: string;
  readonly features: readonly string[];
  readonly href: string;
  readonly action: string;
}

interface PricingTiersProps {
  readonly tiers: readonly PricingTier[];
}

export function PricingTiers({ tiers }: PricingTiersProps) {
  return (
    <ul aria-label="Pricing tiers" className="pricing-grid">
      {tiers.map((tier) => (
        <li className="pricing-tier" key={tier.name}>
          <h2 className="pricing-tier-name">{tier.name}</h2>
          <p className="pricing-tier-price">
            {tier.price} <span>{tier.interval}</span>
          </p>
          <p className="pricing-tier-capacity">{tier.capacity}</p>
          <p className="pricing-tier-description">{tier.description}</p>
          <ul className="pricing-tier-features">
            {tier.features.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <a
            className="product-button"
            href={tier.href}
            aria-label={`${tier.action}: ${tier.name}`}
          >
            {tier.action}
          </a>
        </li>
      ))}
    </ul>
  );
}
