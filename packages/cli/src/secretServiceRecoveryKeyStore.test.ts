import { expect, test } from "bun:test";
import {
  createSecretServiceRecoveryKeyStore,
  type SecretsApi,
} from "./secretServiceRecoveryKeyStore";

const KEY = "abandon ability able";
const LOCKED = "Cannot create an item in a locked collection (code: 2)";

interface FakeKeyringOptions {
  /** Every call fails at once, as with no libsecret or no D-Bus session. */
  readonly unavailable?: string;
  /** Writes succeed but are dropped. */
  readonly dropWrites?: boolean;
  /** A refused write echoes this message. */
  readonly writeError?: (value: string) => string;
}

/**
 * Measured against GNOME Keyring: a locked keyring that cannot show its
 * unlock prompt answers lookups with null and deletes with false, and refuses
 * writes.
 */
function fakeKeyring(options: FakeKeyringOptions = {}) {
  const items = new Map<string, string>();
  const writes: { name: string; value: string }[] = [];
  const state = { locked: false };
  const reachable = () => {
    if (options.unavailable) throw new Error(options.unavailable);
  };
  const secrets: SecretsApi = {
    async get({ name }) {
      reachable();
      return state.locked ? null : (items.get(name) ?? null);
    },
    async delete({ name }) {
      reachable();
      return state.locked ? false : items.delete(name);
    },
    async set({ name, value }) {
      reachable();
      writes.push({ name, value });
      if (options.writeError) throw new Error(options.writeError(value));
      if (state.locked) throw new Error(LOCKED);
      if (!options.dropWrites) items.set(name, value);
    },
  };
  return {
    items,
    state,
    store: createSecretServiceRecoveryKeyStore(secrets),
    writes,
  };
}

async function failure(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  return error instanceof Error ? error.message : "";
}

test("keys are saved, read, and removed per target", async () => {
  const keyring = fakeKeyring();
  await keyring.store.save("production", KEY);

  expect(await keyring.store.read("production")).toBe(KEY);
  expect(await keyring.store.read("staging")).toBeNull();
  expect(await keyring.store.remove("staging")).toBe(false);
  expect(await keyring.store.remove("production")).toBe(true);
  expect(await keyring.store.read("production")).toBeNull();
  // Confirming an empty answer leaves no probe behind.
  expect([...keyring.items.keys()]).toEqual([]);
});

test("a locked keyring is reported, not taken for a missing key", async () => {
  const keyring = fakeKeyring();
  await keyring.store.save("production", KEY);
  keyring.state.locked = true;

  const read = await failure(keyring.store.read("production"));
  expect(read).toStartWith(
    `Could not read the recovery key from the keyring, which refused a test write (${LOCKED}).`,
  );
  expect(read).toContain("desktop keyring");
  const removed = await failure(keyring.store.remove("production"));
  expect(removed).toStartWith(
    `Could not remove the recovery key from the keyring, which refused a test write (${LOCKED}).`,
  );
  expect(keyring.items.get("production")).toBe(KEY);
  // The probe carries no secret.
  const probes = keyring.writes.filter(({ name }) => name.endsWith(".probe"));
  expect(probes.length).toBeGreaterThan(0);
  for (const probe of probes) expect(probe.value).not.toContain("abandon");
});

test("a keyring that cannot be reached names the reason", async () => {
  const keyring = fakeKeyring({
    unavailable: "Cannot autolaunch D-Bus without X11 $DISPLAY",
  });

  expect(await failure(keyring.store.read("production"))).toStartWith(
    "Could not read the recovery key from the keyring (Cannot autolaunch D-Bus without X11 $DISPLAY).",
  );
});

test("a refused save shows the keyring's reason with the key removed", async () => {
  const keyring = fakeKeyring({
    writeError: (value) => `rejected "${value}"`,
  });

  const message = await failure(keyring.store.save("production", KEY));
  expect(message).toStartWith(
    'Could not save the recovery key in the keyring (rejected "[recovery key]").',
  );
  expect(message).not.toContain("abandon");
});

test("a save that does not read back fails", async () => {
  const keyring = fakeKeyring({ dropWrites: true });

  expect(await failure(keyring.store.save("production", KEY))).toBe(
    "Could not save the recovery key in the keyring: the keyring accepted it, but it did not read back.",
  );
});
