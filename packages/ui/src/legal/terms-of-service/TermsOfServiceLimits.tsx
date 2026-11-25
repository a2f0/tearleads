import { LegalContact } from "../LegalContact";
import type { LegalDocumentSectionProps } from "../legalDocumentProps";

/**
 * The Terms of Service's sections on ending service, warranties, liability,
 * disputes, changes, and contact.
 */
export function TermsOfServiceLimits({ id }: LegalDocumentSectionProps) {
  return (
    <>
      <section
        id={id("ending-service")}
        aria-labelledby={id("ending-service-title")}
      >
        <h2 id={id("ending-service-title")}>7. Ending or suspending service</h2>
        <p>
          You may stop using the Services at any time. Cancel any subscription
          separately, export information you wish to keep, and use the available
          deletion controls or contact us about remote records. Uninstalling or
          destroying a local identity does not erase all remote information.
          Retention and deletion limits are explained in the Privacy Policy.
        </p>
        <p>
          We may restrict or suspend hosted access for a material breach of
          these Terms, nonpayment, a legal requirement, or a credible security
          or abuse risk. Where reasonably practicable and lawful, we will
          explain the reason and offer an opportunity to address it. Urgent
          threats or legal restrictions may require action without advance
          notice. You may contact us to ask for review.
        </p>
        <p>
          If we discontinue a paid hosted service for reasons unrelated to your
          breach, we will give reasonable advance notice where practicable and
          refund prepaid fees for the unused discontinued portion. We will
          provide a reasonable opportunity to export available data where
          technically feasible and lawful. Ending hosted access does not let us
          erase copies already on your devices or guarantee that remote-only
          data remains recoverable.
        </p>
      </section>

      <section
        id={id("availability")}
        aria-labelledby={id("availability-title")}
      >
        <h2 id={id("availability-title")}>8. Availability and warranties</h2>
        <p>
          We work to provide useful, reliable, and secure Services, but outages,
          bugs, compatibility changes, network failures, and data loss are
          possible. Encryption has limits, particularly on compromised devices
          or when keys are exposed. Unless separately agreed in writing, we do
          not promise an uptime level, uninterrupted access, or permanent
          storage of every version or attachment. The Services are not designed
          for emergency or safety-critical use.
        </p>
        <p>
          To the extent permitted by applicable law, the Services are provided
          “as is” and “as available,” without implied warranties of
          merchantability, fitness for a particular purpose, or
          non-infringement. This does not exclude an express commitment in these
          Terms or any warranty, guarantee, reasonable-care obligation, or
          consumer remedy that the law does not allow us to exclude.
        </p>
        <p>
          Third-party stores, payment systems, devices, and services have their
          own terms. Their outages or decisions can affect your use of
          Tearleads. Their terms do not displace your mandatory rights against
          us.
        </p>
      </section>

      <section id={id("liability")} aria-labelledby={id("liability-title")}>
        <h2 id={id("liability-title")}>9. Limits on liability</h2>
        <p>
          To the extent permitted by applicable law, Tearleads is not liable for
          indirect, incidental, special, consequential, or punitive damages, or
          lost profits, arising from the Services. Our total liability arising
          from or relating to the Services is limited to the greater of US $100
          or the amount you paid us for the affected Services in the 12 months
          before the event giving rise to the claim.
        </p>
        <p>
          These exclusions and limits do not apply to fraud, willful misconduct,
          gross negligence, death or personal injury caused by negligence, or
          any liability that cannot lawfully be limited or excluded. They do not
          reduce mandatory consumer remedies or privacy rights. Where local law
          does not permit a particular limitation, that limitation does not
          apply to you.
        </p>
      </section>

      <section id={id("disputes")} aria-labelledby={id("disputes-title")}>
        <h2 id={id("disputes-title")}>10. Governing law and disputes</h2>
        <p>
          Tennessee law governs these Terms, without its conflict-of-laws rules,
          except that mandatory protections of the law where you live continue
          to apply. Courts with jurisdiction in Hamilton County, Tennessee may
          hear disputes. This is not an exclusive venue requirement and does not
          prevent you from bringing a claim in another court where applicable
          law permits it.
        </p>
        <p>
          Please contact us if there is a problem so we can try to resolve it.
          Doing so is not a condition of exercising your legal rights and does
          not shorten or extend a legal deadline. These Terms do not require
          private arbitration or waive your right to participate in a class
          action.
        </p>
      </section>

      <section id={id("changes")} aria-labelledby={id("changes-title")}>
        <h2 id={id("changes-title")}>11. Changes and general terms</h2>
        <p>
          We may update the Services and these Terms. Revised Terms will have a
          new effective date, and we will give reasonable advance notice of
          material changes through the Services or another appropriate channel.
          Changes needed urgently for security, legal compliance, or to
          introduce an optional feature may take effect sooner. We will obtain
          acceptance where required by law; changes will not retroactively alter
          an existing dispute.
        </p>
        <p>
          If you do not agree to revised Terms, stop using the affected Services
          and cancel any applicable subscription before the next renewal. Any
          refund rights required by law remain available.
        </p>
        <p>
          These Terms and any separate written service agreement form our
          agreement about the Services. If a provision is unenforceable, the
          remaining provisions continue to apply. A failure to enforce a
          provision is not a waiver. Neither party may transfer this agreement
          in a way that reduces the other party’s mandatory rights; we may
          transfer it with a merger or sale of the relevant business if the
          successor assumes our obligations. Provisions that by their nature
          must continue, including accrued payment obligations, ownership,
          lawful retention, liability, and dispute terms, survive termination.
        </p>
      </section>

      <section id={id("contact")} aria-labelledby={id("contact-title")}>
        <h2 id={id("contact-title")}>12. Contact us</h2>
        <p>
          For questions about these Terms, billing concerns, or legal notices:
        </p>
        <LegalContact />
      </section>
    </>
  );
}
