import { LegalContact } from "../LegalContact";
import { legalContactDetails } from "../legalContactDetails";
import type { LegalDocumentSectionProps } from "../legalDocumentProps";

/**
 * The Privacy Policy's sections on retention, your rights, and how to reach
 * us.
 */
export function PrivacyPolicyChoices({
  id,
  siteHref,
}: LegalDocumentSectionProps) {
  return (
    <>
      <section id={id("retention")} aria-labelledby={id("retention-title")}>
        <h2 id={id("retention-title")}>7. Retention and deletion</h2>
        <p>
          Retention depends on the type of information, whether it is still
          needed to provide the service, security and recovery requirements,
          billing or legal obligations, and any applicable deletion request.
          Different copies and records have different lifecycles:
        </p>
        <ul>
          <li>
            <strong>On your devices:</strong> local data remains until you
            remove it or your browser or device removes it. Destroying a local
            identity is not a request to erase all remote records or cancel
            billing.
          </li>
          <li>
            <strong>Synced content:</strong> deletion updates live service
            state, but signed history, deletion evidence, and related metadata
            may remain. A removed file is eligible for storage cleanup when no
            active attachment references it; physical deletion follows the
            cleanup grace period and successful processing.
          </li>
          <li>
            <strong>Lapsed subscriptions:</strong> remote organization data may
            be purged after the service’s billing grace period. This does not
            necessarily remove local copies. Organization, membership, identity,
            and billing records can remain after the remote content is purged.
          </li>
          <li>
            <strong>Audit records:</strong> some signed access history, deletion
            records, and identifiers currently have no automatic expiry. They
            support verification, prevent identifier reuse across organizations,
            and track unfinished deletion work. Deleting a document does not
            automatically erase this history.
          </li>
          <li>
            <strong>Operational records:</strong> session information, logs,
            diagnostics, support correspondence, and financial records follow
            their service configuration and operational or legal needs. Backups
            and provider-held records may outlast removal from live systems.
          </li>
          <li>
            <strong>Click analytics:</strong> CT deletes click records,
            including their connection IP and associated geography, after 90
            days.
          </li>
        </ul>
        <p>
          We do not promise immediate erasure from every system. Contact us to
          request deletion or information about retention for a particular
          record. We will assess the request under applicable law and explain
          relevant limits. We cannot remotely erase someone else’s exports,
          backups, or downloaded copies.
        </p>
      </section>

      <section id={id("rights")} aria-labelledby={id("rights-title")}>
        <h2 id={id("rights-title")}>8. Your choices and privacy rights</h2>
        <p>
          You can use local features without buying Sync, export available local
          data, manage sharing permissions, revoke sessions, and delete local
          data through the app. You can separately{" "}
          <a href={siteHref("/manage-subscription/")}>
            manage or cancel a web subscription
          </a>
          ; store purchases are managed through the store where you subscribed.
        </p>
        <p>
          Depending on your location and the law that applies, you may have
          rights to access, correct, delete, or receive a portable copy of
          personal information; restrict or object to processing; withdraw
          consent; or appeal a denied request. You may also complain to your
          local privacy regulator or state attorney general. We will not
          unlawfully discriminate against you for exercising privacy rights.
        </p>
        <p>
          Send requests, authorized-agent requests, or appeals to{" "}
          <a href={`mailto:${legalContactDetails.email}`}>
            {legalContactDetails.email}
          </a>
          . Include enough information to identify the relevant account or
          records. We may ask for proportionate proof of identity or authority,
          but will not ask you to send your private keys or recovery phrase. We
          will respond within the time required by applicable law and explain
          any exception or denial. Encryption can limit our ability to locate or
          return readable content; your own device’s export tools may be the
          best way to obtain it.
        </p>
      </section>

      <section
        id={id("international")}
        aria-labelledby={id("international-title")}
      >
        <h2 id={id("international-title")}>
          9. Where information is processed
        </h2>
        <p>
          Tearleads is based in the United States, and our primary production
          infrastructure is in the United States. Our providers may process
          information in other countries, whose privacy laws may differ from
          those where you live. Where applicable law requires safeguards for a
          transfer, those requirements still apply; using the service does not
          waive your rights. Contact us for details about the arrangements
          relevant to your data.
        </p>
      </section>

      <section id={id("children")} aria-labelledby={id("children-title")}>
        <h2 id={id("children-title")}>10. Children’s privacy</h2>
        <p>
          The services are intended for adults, as described in our Terms of
          Service, and are not directed to children under 13. We do not
          knowingly collect personal information from children under 13. If you
          believe a child has provided personal information to us, contact us so
          we can investigate and take appropriate steps, including deletion
          where required.
        </p>
      </section>

      <section id={id("updates")} aria-labelledby={id("updates-title")}>
        <h2 id={id("updates-title")}>11. Changes to this policy</h2>
        <p>
          We may update this policy as the services, our practices, or legal
          requirements change. We will publish the revised version with a new
          effective date and give additional notice of material changes through
          the service or another appropriate channel. Where the law requires
          consent to a new use of information, we will obtain it before that
          use.
        </p>
      </section>

      <section id={id("contact")} aria-labelledby={id("contact-title")}>
        <h2 id={id("contact-title")}>12. Contact us</h2>
        <p>
          For privacy questions, data requests, or concerns about this policy:
        </p>
        <LegalContact />
      </section>
    </>
  );
}
