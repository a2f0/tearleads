import { legalContactDetails } from "../legalContactDetails";
import type { LegalDocumentSectionProps } from "../legalDocumentProps";

/**
 * The Privacy Policy's sections on what Tearleads handles, why, and who else
 * receives it.
 */
export function PrivacyPolicyHandling({
  id,
  siteHref,
}: LegalDocumentSectionProps) {
  return (
    <>
      <section id={id("scope")} aria-labelledby={id("scope-title")}>
        <h2 id={id("scope-title")}>1. Who we are and what this covers</h2>
        <p>
          {legalContactDetails.operator} (“Tearleads,” “we,” “us,” or “our”),
          based in {legalContactDetails.location}, operates the Tearleads
          website, applications, and hosted Sync and Sharing services. This
          policy explains how we handle personal information in those services
          and when you contact us.
        </p>
        <p>
          It does not describe an independent organization’s use of information
          you share with it, or a third-party service’s own processing. If an
          employer or another organization manages your access, its policies may
          also apply. Our{" "}
          <a href={siteHref("/terms-of-service/")}>Terms of Service</a> cover
          use of Tearleads.
        </p>
      </section>

      <section id={id("information")} aria-labelledby={id("information-title")}>
        <h2 id={id("information-title")}>2. Information we handle</h2>
        <h3>Content on your device and in sync</h3>
        <p>
          Tearleads stores your documents, notes, contacts, files, preferences,
          and cryptographic identity material locally. Content kept only on your
          device is not uploaded to our storage unless you use a feature that
          sends it, such as Sync and Sharing. Local use does not mean the app
          never connects to the internet: loading the web app, registering an
          identity, checking service status, and error reporting can involve
          network requests.
        </p>
        <p>
          When you sync, our services receive encrypted document updates,
          encrypted files and content metadata, and encrypted key material for
          authorized recipients. They also receive structural information such
          as identity, organization, container, document, and file identifiers;
          public keys and signatures; membership and access records; version
          information; timestamps; and payload sizes. These records are not all
          end-to-end encrypted.
        </p>
        <h3>Connections and sessions</h3>
        <p>
          Our services and infrastructure providers process IP addresses,
          request times, requested routes, response status, and technical
          browser or device information. Authenticated sessions include identity
          references, creation and activity times, and connection IP addresses.
          These records support authentication, session management,
          troubleshooting, and abuse prevention. Identity records also retain
          the registration IP address when available and the most recent
          activity time, separately from individual sessions.
        </p>
        <h3>Subscriptions and communications</h3>
        <p>
          If you purchase a subscription, we and our billing providers process
          billing contact details, customer and organization identifiers,
          selected plans, subscription status, invoices, transaction amounts,
          currency, and purchase or refund records. Payment details are entered
          through Stripe or the applicable app store; Tearleads does not receive
          your full payment-card number or security code through those payment
          forms.
        </p>
        <p>
          If you email us or send a support report, we receive your address,
          message, and anything you choose to attach. Support communications are
          not covered by the app’s end-to-end encryption. Please do not send
          private keys, recovery phrases, passwords, or unnecessary personal
          information.
        </p>
        <h3>Limited error diagnostics</h3>
        <p>
          Configured production apps and the API send limited error reports to
          Sentry to help us fix failures. Reports include a generic error type,
          application code location, release and platform details, and, in the
          app, a short trail of approved screen names and actions with
          timestamps. When an app request to our API gets no response, a report
          can also say what kind of failure it was, the request method and route
          pattern (never its identifiers), retry count, a rough duration, and
          whether the device reported a connection.
        </p>
        <p>
          The reporting code excludes document contents, file and contact names,
          keys, passwords, account identifiers, raw error messages, full page
          URLs, and request bodies. It does not send session recordings,
          screenshots, or attachments. A direct connection to Sentry still
          exposes network information, including your IP address, to its
          infrastructure. The marketing website does not use this app
          error-reporting integration.
        </p>
        <h3>Click analytics</h3>
        <p>
          Our hosted website, web app, and demo use CT, operated by Tearleads,
          LLC, to understand which interface elements people use. CT receives
          click times, generic element types, and website, application, and
          environment labels. We send a generic page path, not document or
          organization routes. We do not send text contents, form values, link
          destinations, query strings, account identifiers, or document
          contents. Native mobile and desktop apps do not use this click
          collector.
        </p>
        <p>
          Cloudflare hosts CT and stores the connection IP address with
          approximate geography, such as country, region, and city, alongside
          each click. This geography comes from the network connection, not
          device GPS. The analytics dashboard requires an administrator login.
          CT click records expire after 90 days.
        </p>
      </section>

      <section id={id("purposes")} aria-labelledby={id("purposes-title")}>
        <h2 id={id("purposes-title")}>3. How and why we use information</h2>
        <ul>
          <li>
            Provide local app functionality, authenticate identities, deliver
            encrypted sync, and enforce sharing permissions.
          </li>
          <li>
            Understand use of the hosted interface through the limited click
            analytics described above.
          </li>
          <li>
            Process purchases, manage subscription entitlements, reconcile
            payments, and maintain billing records.
          </li>
          <li>
            Operate, secure, troubleshoot, and improve the reliability of the
            services, including investigating misuse.
          </li>
          <li>
            Respond to support and privacy requests and communicate important
            service or policy changes.
          </li>
          <li>
            Meet legal obligations, resolve disputes, and protect the rights and
            safety of users and others.
          </li>
        </ul>
        <p>
          Where applicable law requires a legal basis, we rely on performing our
          contract for requested services; our legitimate interests in security,
          reliability, understanding use of the hosted interface, and responding
          to requests; applicable legal obligations; and consent where required.
          Where we rely on consent, you may withdraw it without affecting the
          lawfulness of earlier processing. Information needed to authenticate,
          sync, or complete a payment is necessary for that feature; without it,
          we cannot provide that feature.
        </p>
        <p>
          We do not sell personal information or disclose it for targeted or
          cross-context behavioral advertising. We do not use personal
          information for automated decisions that produce legal or similarly
          significant effects, such as decisions about credit or employment.
        </p>
      </section>

      <section id={id("encryption")} aria-labelledby={id("encryption-title")}>
        <h2 id={id("encryption-title")}>4. What encryption protects</h2>
        <p>
          Tearleads encrypts synced content on your device before uploading it.
          Our hosted services do not receive the unwrapped private keys or
          content keys needed to read that content. Encryption does not conceal
          all service metadata, protect an already compromised device, or
          prevent an authorized recipient from copying what they can read. No
          system can guarantee absolute security.
        </p>
        <p>
          When you share, authorized recipients can decrypt the content made
          available to them. Depending on the permissions you grant, others may
          be able to edit it or manage access. Organization administrators
          manage membership and service access; being an administrator does not,
          by itself, give our servers the keys to decrypt your content.
        </p>
        <p className="legal-callout">
          Removing access is not a recall mechanism. Recipients may retain
          content or keys already received. New recipients may be able to read
          retained history available through the content’s current sharing
          arrangement.
        </p>
      </section>

      <section id={id("providers")} aria-labelledby={id("providers-title")}>
        <h2 id={id("providers-title")}>5. Providers and other disclosures</h2>
        <p>
          We use providers to operate the services. They process information
          relevant to their roles, not automatically everything described in
          this policy:
        </p>
        <ul>
          <li>
            <strong>Hosting and delivery:</strong> Cloudflare for website
            delivery, application hosting, and encrypted file storage;
            PlanetScale for the hosted database.
          </li>
          <li>
            <strong>Payments:</strong>{" "}
            <a href="https://stripe.com/privacy">Stripe</a> for web payments and
            subscription management;{" "}
            <a href="https://www.revenuecat.com/privacy/">RevenueCat</a> for
            cross-platform subscription entitlements; and Apple or Google when
            you purchase through their stores. Billing providers may process
            information for their own fraud-prevention and legal obligations
            under their policies.
          </li>
          <li>
            <strong>Error reporting:</strong>{" "}
            <a href="https://sentry.io/privacy/">Sentry</a> for the limited
            diagnostics described above.
          </li>
          <li>
            <strong>Click analytics:</strong> CT, operated by Tearleads, LLC and
            hosted on Cloudflare, for the click records and connection geography
            described above.
          </li>
          <li>
            <strong>Communications and business support:</strong> email
            providers and professional advisers when needed to handle your
            messages, operate the business, or meet legal obligations.
          </li>
        </ul>
        <p>
          We also disclose information to recipients you authorize through
          sharing; when reasonably necessary to comply with valid legal process,
          investigate fraud or security threats, or protect rights and safety;
          and in connection with a merger, acquisition, financing, or sale of
          assets, subject to applicable privacy obligations. A legal request
          cannot give us decryption keys we do not possess. We may disclose
          other information we do possess.
        </p>
      </section>

      <section
        id={id("device-storage")}
        aria-labelledby={id("device-storage-title")}
      >
        <h2 id={id("device-storage-title")}>6. Cookies and device storage</h2>
        <p>
          The app uses browser or device storage for local databases, encrypted
          files, saved identity material, settings, and session state. This
          storage supports functionality and offline use; it is not an
          advertising profile. Infrastructure and payment providers may use
          cookies or similar technologies for security, fraud prevention, or
          checkout under their own policies.
        </p>
        <p>
          The marketing website does not use advertising trackers or analytics
          cookies. CT honors the browser’s “Do Not Track” and Global Privacy
          Control settings and the CT opt-out browser extension. These choices
          stop click collection on the website, web app, and demo; they do not
          disable functionality or the separate error diagnostics. CT does not
          create a persistent visitor identifier or an advertising profile. You
          can manage storage and permissions through your browser or device.
          Blocking or clearing storage can disable features or permanently
          remove local keys and unsynced data. Export a backup first if you need
          to keep them.
        </p>
      </section>
    </>
  );
}
