import { LEGAL_TERMS_VERSION } from "@tearleads/client-sdk";
import { createIdentitySeedPhrase } from "@tearleads/crypto";
import { registerAccount } from "./registerAccount";

/** Registers a fresh account the way an app install does and returns its key. */
export async function registerCliTestAccount(apiBaseUrl: string) {
  const seedPhrase = createIdentitySeedPhrase();
  const account = await registerAccount({
    agreeToLegalTerms: async () => LEGAL_TERMS_VERSION,
    apiBaseUrl,
    recoveryKey: seedPhrase,
  });
  if (!account.created)
    throw new Error("a fresh test key already had an account");
  return { ...account, seedPhrase };
}
