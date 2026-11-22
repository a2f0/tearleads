import { expect, mock, test } from "bun:test";
import {
  browserPasswordKeychainFactory,
  createBrowserPasswordKeychain,
} from "./browserPasswordKeychain";

class FakePasswordCredential {
  readonly type = "password";
  readonly id: string;
  readonly name: string;
  readonly password: string;
  constructor(init: { id: string; name: string; password: string }) {
    this.id = init.id;
    this.name = init.name;
    this.password = init.password;
  }
}

function fakeCredentials(picked: unknown = null) {
  const store = mock(async (_credential: unknown) => undefined);
  const get = mock(async (_options: CredentialRequestOptions) => picked);
  const container = {
    create: async () => null,
    get,
    preventSilentAccess: async () => undefined,
    store,
  } as unknown as CredentialsContainer;
  return { container, get, store };
}

test("saving stores a password credential under the entry's account", async () => {
  const { container, store } = fakeCredentials();
  const keychain = createBrowserPasswordKeychain(
    FakePasswordCredential,
    container,
  );
  await expect(
    keychain.save({ account: "Identity 0123456789ab", passphrase: "a b c" }),
  ).resolves.toBe("offered");
  expect(store).toHaveBeenCalledTimes(1);
  const [stored] = store.mock.calls[0] ?? [];
  expect(stored).toBeInstanceOf(FakePasswordCredential);
  expect(stored).toMatchObject({
    id: "Identity 0123456789ab",
    name: "Identity 0123456789ab",
    password: "a b c",
  });
});

test("picking asks for a password credential and returns its passphrase", async () => {
  const picked = new FakePasswordCredential({
    id: "Identity 0123456789ab",
    name: "Identity 0123456789ab",
    password: "a b c",
  });
  const { container, get } = fakeCredentials(picked);
  const keychain = createBrowserPasswordKeychain(
    FakePasswordCredential,
    container,
  );
  await expect(keychain.pick()).resolves.toBe("a b c");
  expect(get).toHaveBeenCalledWith({ mediation: "required", password: true });
});

test("a dismissed chooser, or a credential of another kind, picks nothing", async () => {
  for (const picked of [null, { id: "federated", type: "federated" }]) {
    const { container } = fakeCredentials(picked);
    const keychain = createBrowserPasswordKeychain(
      FakePasswordCredential,
      container,
    );
    await expect(keychain.pick()).resolves.toBeNull();
  }
});

test("a browser without PasswordCredential gets no keychain", () => {
  const { container } = fakeCredentials();
  const navigator = { credentials: container } as Navigator;
  expect(browserPasswordKeychainFactory({ navigator })).toBeUndefined();
  expect(
    browserPasswordKeychainFactory({
      navigator,
      PasswordCredential: FakePasswordCredential,
    }),
  ).toBeFunction();
});
