import { legalContactDetails } from "../legalContactDetails";
import type { LegalDocumentSectionProps } from "../legalDocumentProps";

/**
 * The Terms of Service's sections on the agreement, using the service, keys,
 * content, conduct, and billing.
 */
export function TermsOfServiceUse({ id, siteHref }: LegalDocumentSectionProps) {
  return (
    <>
      <section id={id("agreement")} aria-labelledby={id("agreement-title")}>
        <h2 id={id("agreement-title")}>1. The agreement</h2>
        <p>
          These Terms of Service (“Terms”) are between you and{" "}
          {legalContactDetails.operator} (“Tearleads,” “we,” “us,” or “our”),
          based in {legalContactDetails.location}. They cover our website,
          applications, and hosted Sync and Sharing services (together, the
          “Services”).
        </p>
        <p>
          By accepting these Terms or using the Services after being given
          notice of them and an opportunity to review them, you agree to these
          Terms. If you do not agree, do not use the Services. You must be at
          least 18 and legally able to enter this agreement. If you act for an
          organization, you confirm that you have authority to bind it, and
          “you” includes that organization.
        </p>
        <p>
          Our <a href={siteHref("/privacy-policy/")}>Privacy Policy</a> explains
          information handling. Agreeing to these Terms does not replace any
          separate privacy consent required by law. Mandatory consumer
          protections remain in effect regardless of these Terms.
        </p>
      </section>

      <section id={id("service")} aria-labelledby={id("service-title")}>
        <h2 id={id("service-title")}>2. Using Tearleads</h2>
        <p>
          Tearleads provides device-first tools for working with your
          information, with optional paid Sync and Sharing. Available features
          can differ by platform, version, plan, and connectivity. Local
          functionality does not require a paid sync subscription. Hosted
          functionality requires the relevant service access and, where
          applicable, an active subscription.
        </p>
        <p>
          Subject to these Terms, you may use the Services for lawful personal
          or organizational purposes. We retain rights in the Services, our
          branding, and our materials, excluding your content. Software supplied
          under a separate license remains subject to that license; these Terms
          do not take away rights that license grants you.
        </p>
        <p>
          You are responsible for the devices, connectivity, permissions, and
          authorized activity needed to use the Services. Keep billing and
          contact information you provide accurate. Do not use another person’s
          identity or credentials without permission.
        </p>
      </section>

      <section id={id("keys")} aria-labelledby={id("keys-title")}>
        <h2 id={id("keys-title")}>3. Protect your keys and keep backups</h2>
        <p>
          Your cryptographic identity controls access to your encrypted content.
          You are responsible for protecting your devices, recovery phrase,
          recovery QR code, private keys, and backup passwords. Anyone with your
          recovery material may be able to act as you and access your data.
        </p>
        <p className="legal-callout">
          We cannot reset your identity keys or recover encrypted content
          without the necessary keys. Losing your keys and every usable recovery
          copy can mean permanent loss of access, even if a subscription is
          still active.
        </p>
        <p>
          Keep independent backups of important information and verify that they
          can be restored. Sync is not a guarantee of permanent archival storage
          or a substitute for backups. An export may include only files
          available locally, not every remote file. Clearing browser storage,
          uninstalling, destroying a local identity, or losing a device can
          remove unsynced data. Contact us promptly if you suspect unauthorized
          service access, but do not email us your recovery material.
        </p>
      </section>

      <section id={id("content")} aria-labelledby={id("content-title")}>
        <h2 id={id("content-title")}>4. Your content and sharing</h2>
        <p>
          You retain ownership of the content you create, import, store, or
          share. You give us a limited, non-exclusive permission to store, copy,
          transmit, and otherwise process content only as needed to provide the
          Services you request, carry out your instructions, secure the
          Services, and meet applicable legal obligations. This permission does
          not transfer ownership or grant a right to use your content for
          advertising.
        </p>
        <p>
          Our ability to process encrypted content is limited by the encryption
          design. The permission above does not give us keys we do not possess.
          It continues only as needed for those purposes, including retained
          copies and records described in the Privacy Policy after use ends.
        </p>
        <p>
          You must have the rights and permissions needed to use and share your
          content, including personal information about other people. You are
          responsible for choosing recipients and access levels. Authorized
          users may read, edit, download, or further share content as their
          permissions allow. Removing access cannot erase copies or keys already
          received, and retained history may be available to later authorized
          recipients.
        </p>
        <p>
          Organization administrators can manage membership, billing, and
          service access within their authority. Changes by an administrator,
          including removal from an organization or a subscription lapse, may
          affect your access. You and your organization are responsible for
          agreeing on content ownership and administration. We do not resolve
          ownership disputes merely because one party possesses a key or pays an
          invoice.
        </p>
      </section>

      <section
        id={id("acceptable-use")}
        aria-labelledby={id("acceptable-use-title")}
      >
        <h2 id={id("acceptable-use-title")}>5. Acceptable use</h2>
        <p>Do not use the Services to:</p>
        <ul>
          <li>
            Break applicable law or violate intellectual property, privacy, or
            other rights.
          </li>
          <li>
            Distribute malware, commit fraud, threaten or exploit others, or
            facilitate child sexual exploitation.
          </li>
          <li>
            Access identities, content, infrastructure, or systems without
            authorization, or bypass access controls or billing restrictions.
          </li>
          <li>
            Disrupt the Services, overwhelm infrastructure, or interfere with
            other users’ access.
          </li>
          <li>
            Misrepresent your identity or authority, or use sharing and
            communications for unsolicited abusive activity.
          </li>
        </ul>
        <p>
          These restrictions do not prohibit activity protected by applicable
          law or rights under a separate software license. If you discover a
          security issue, report it to{" "}
          <a href={`mailto:${legalContactDetails.email}`}>
            {legalContactDetails.email}
          </a>{" "}
          without accessing other people’s data or disrupting the Services. This
          invitation does not authorize testing systems you do not control.
        </p>
      </section>

      <section id={id("billing")} aria-labelledby={id("billing-title")}>
        <h2 id={id("billing-title")}>
          6. Subscriptions, renewal, and cancellation
        </h2>
        <h3>Prices and payment</h3>
        <p>
          Paid plans, included capacity, currency, billing interval, taxes, and
          applicable charges are shown at checkout. Our{" "}
          <a href={siteHref("/pricing/")}>pricing page</a> describes the
          standard plans; store pricing and regional charges may differ. A
          subscription applies to the organization or entitlement identified at
          purchase, not automatically to every identity or organization you
          create. Unless checkout states otherwise, subscriptions are monthly.
        </p>
        <p>
          When you confirm a recurring purchase, you authorize the payment
          provider to charge the disclosed amount and applicable taxes for each
          billing period until canceled. Plan or capacity changes may change the
          price and may involve prorated charges, as disclosed by the billing
          provider. We will give notice of changes to recurring prices before
          they apply and obtain additional consent where required by law.
        </p>
        <h3>How to cancel</h3>
        <p>
          For web subscriptions, use{" "}
          <a href={siteHref("/manage-subscription/")}>Manage subscription</a> to
          access Stripe with the billing email used at checkout. This route can
          be used even if you have lost your Tearleads identity keys. For App
          Store or Google Play purchases, cancel through that store’s
          subscription settings. Contact us if you cannot access the
          cancellation route.
        </p>
        <p>
          Cancellation stops future renewals after the current paid period; paid
          access generally continues through that period unless a refund, store
          rule, legal requirement, or suspension changes it. Cancel before the
          renewal deadline shown by your provider. Deleting the app, removing a
          local identity, leaving an organization, or ceasing to use the
          Services does not cancel a subscription.
        </p>
        <h3>Refunds and failed payments</h3>
        <p>
          Except where required by law or expressly offered at purchase,
          payments for the current billing period are non-refundable and we do
          not provide partial-period credits merely because you stop using the
          Services. Contact us about billing errors or refund requests. Store
          purchases are also subject to the store’s refund process. Nothing here
          removes statutory cancellation, withdrawal, refund, or service-quality
          rights.
        </p>
        <p>
          Failed payments or an expired entitlement may restrict hosted
          features. After the applicable grace period, remote organization data
          may be permanently purged. Reactivating billing does not guarantee
          recovery of purged data. Keep local copies and independent backups of
          anything important.
        </p>
      </section>
    </>
  );
}
