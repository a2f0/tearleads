import type {
  CreatePasswordKeychainFn,
  PasswordKeychain,
} from "./PasswordKeychain";

/**
 * The Credential Management API's `PasswordCredential`, which only Chromium
 * browsers implement and TypeScript's DOM types therefore leave out.
 */
interface BrowserPasswordCredential extends Credential {
  readonly password: string;
}

export type PasswordCredentialConstructor = new (init: {
  readonly id: string;
  readonly name: string;
  readonly password: string;
}) => BrowserPasswordCredential;

declare global {
  interface CredentialRequestOptions {
    /** Chromium: include saved `PasswordCredential`s. */
    password?: boolean;
  }
  interface Window {
    PasswordCredential?: PasswordCredentialConstructor;
  }
}

/**
 * A {@link PasswordKeychain} backed by the browser's password manager. Saving
 * shows the browser's own save prompt, which does not report whether the user
 * kept the entry; picking shows its account chooser even for one entry.
 */
export function createBrowserPasswordKeychain(
  PasswordCredential: PasswordCredentialConstructor,
  credentials: CredentialsContainer,
): PasswordKeychain {
  return {
    async pick() {
      const credential = await credentials.get({
        mediation: "required",
        password: true,
      });
      return credential instanceof PasswordCredential
        ? credential.password
        : null;
    },
    async save({ account, passphrase }) {
      await credentials.store(
        new PasswordCredential({
          id: account,
          name: account,
          password: passphrase,
        }),
      );
      return "offered";
    },
  };
}

/**
 * The browser keychain for a web shell, or `undefined` in a browser without
 * `PasswordCredential` (Safari, Firefox), which then offers no save.
 */
export function browserPasswordKeychainFactory(
  browser: Pick<Window, "PasswordCredential" | "navigator"> = window,
): CreatePasswordKeychainFn | undefined {
  const { PasswordCredential, navigator } = browser;
  const credentials: CredentialsContainer | undefined = navigator.credentials;
  if (!PasswordCredential || !credentials) return undefined;
  return () => createBrowserPasswordKeychain(PasswordCredential, credentials);
}
