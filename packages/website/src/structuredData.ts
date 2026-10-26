import { legalDetails } from "./legal";
import { siteName, siteOrigin } from "./seo";

/** The platforms the home page lists; the native apps are not yet public. */
export const availablePlatforms = ["macOS", "Linux", "Web"] as const;

const organizationId = `${siteOrigin}/#organization`;

/**
 * The home page's schema.org graph. It states only what the site already
 * says: who operates Tearleads, where it runs, and that it is free on your
 * device. No ratings or reviews are claimed.
 */
export function homeStructuredData(description: string): object {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: siteName,
        legalName: legalDetails.operator,
        url: `${siteOrigin}/`,
        logo: `${siteOrigin}/apple-touch-icon.png`,
      },
      {
        "@type": "WebSite",
        "@id": `${siteOrigin}/#website`,
        name: siteName,
        url: `${siteOrigin}/`,
        publisher: { "@id": organizationId },
      },
      {
        "@type": "SoftwareApplication",
        name: siteName,
        description,
        applicationCategory: "ProductivityApplication",
        operatingSystem: availablePlatforms.join(", "),
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": organizationId },
      },
    ],
  };
}
