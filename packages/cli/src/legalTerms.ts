import {
  LEGAL_DOCUMENT_URLS,
  LEGAL_TERMS_VERSION,
} from "@tearleads/client-sdk";
import type { CliContext } from "./cliContext";

/**
 * Resolves to the legal terms revision the person running the command agreed
 * to, or rejects when they did not. Called only when an account is about to
 * be created, and asks at most once per command.
 */
export type LegalTermsAgreement = () => Promise<string>;

export const LEGAL_TERMS_REQUIRED_MESSAGE =
  "Creating an account requires agreeing to the Privacy Policy and Terms of Service. Review them, then answer yes, or pass --accept-terms.";

async function agree(
  context: CliContext,
  acceptedByFlag: boolean,
): Promise<string> {
  context.stderr(
    `Creating an account means agreeing to the Tearleads Privacy Policy and Terms of Service (effective ${LEGAL_TERMS_VERSION}):`,
  );
  context.stderr(`  ${LEGAL_DOCUMENT_URLS.privacyPolicy}`);
  context.stderr(`  ${LEGAL_DOCUMENT_URLS.termsOfService}`);
  if (acceptedByFlag) {
    context.stderr("Agreed with --accept-terms.");
    return LEGAL_TERMS_VERSION;
  }
  // Without a terminal (stdin may be carrying the recovery key) only the flag
  // can agree.
  const answer = await context.readLine?.("Type yes to agree: ");
  if (answer?.trim().toLowerCase() === "yes") return LEGAL_TERMS_VERSION;
  throw new Error(LEGAL_TERMS_REQUIRED_MESSAGE);
}

/**
 * The command's {@link LegalTermsAgreement}: `--accept-terms` agrees up front,
 * otherwise the terminal asks the first time an account is created. An
 * answer, or a refusal, stands for the rest of the command.
 */
export function legalTermsAgreement(input: {
  readonly acceptTerms?: boolean | undefined;
  readonly context: CliContext;
}): LegalTermsAgreement {
  let agreement: Promise<string> | null = null;
  return () => {
    agreement ??= agree(input.context, input.acceptTerms === true);
    return agreement;
  };
}
