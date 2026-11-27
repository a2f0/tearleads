import { afterEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  createMemoryBlobStore,
  Tearleads,
  TwoFactorLoginError,
} from "@tearleads/client-sdk";
import { createTestExecSql } from "@tearleads/test-utils";
import { readDocument, readText } from "../harness/documentReads";
import { expectNoSecurityIncidents } from "../harness/expectations";
import { documentWrite } from "../harness/transport";
import { until } from "../harness/until";
import { World } from "../harness/world";

let world: World | null = null;
afterEach(() => {
  world?.dispose();
  world = null;
});

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(encoded: string): Uint8Array {
  const clean = encoded.replace(/[\s=-]+/gu, "").toUpperCase();
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value < 0) throw new Error(`Invalid base32 character: ${char}`);
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

/** RFC 6238 6-digit TOTP code for the current 30-second step. */
function currentTotpCode(secretBase32: string, nowMs = Date.now()): string {
  const step = Math.floor(nowMs / 1000 / 30);
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const digest = createHmac("sha1", decodeBase32(secretBase32))
    .update(counter)
    .digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, "0");
}

// When an organization administrator requires two-factor authentication for a
// member, that member's existing non-2FA session gets 403
// `organization_two_factor_required` on org routes while keeping its local
// projection and queued edits intact. Turning on TOTP verifies the session and
// automatically re-requests domain sync lanes so the held edit lands, a
// remembered device token lets restarts sign back in without a new code, and
// a fresh install must supply a second factor (such as a recovery code).
test("organization two-factor enforcement holds queued edits until TOTP enrollment and gates fresh logins", async () => {
  world = await World.create();
  const alice = await world.register("alice");
  const bob = await world.register("bob");
  await world.addToOrganization(alice, bob);
  const folder = await world.createFolder(alice, world.root(alice), "Shared");
  const document = await world.createDocument(alice, folder, "v1\n");
  await world.shareWithUser(alice, folder, bob);

  const aliceDevice = alice.devices[0];
  const bobDevice = bob.devices[0];
  if (!aliceDevice || !bobDevice) throw new Error("Expected original devices");
  const bobStore = await readDocument(bobDevice, world.documentRef(document));
  if (!bobStore) throw bobDevice.failure("cannot open shared document");
  expect(bobStore.getSnapshot().text).toBe("v1\n");

  // Alice requires two-factor authentication for Bob on her organization roster.
  const roster = await aliceDevice.sdk.organizations.setRosterTwoFactorRequired(
    bob.userId,
    true,
  );
  expect(roster?.twoFactorRequired).toBe(true);

  // Bob edits under his unverified session: the API refuses with 403
  // `organization_two_factor_required`, but his local edit stays queued.
  const beforeRefusal = bobDevice.transport.history.length;
  await bobStore.setText("v1\nbob queued under 2fa\n");
  await bobDevice.idle();
  expect(
    bobDevice.transport.history
      .slice(beforeRefusal)
      .some(
        ({ status, errorCode }) =>
          status === 403 && errorCode === "organization_two_factor_required",
      ),
  ).toBe(true);
  expect(
    (
      await bobDevice.sdk.containerContents
        .documentQueries()
        .listPendingWrites()
    ).some((item) => item.remoteId === document.documentId),
  ).toBe(true);
  expect(bobStore.getSnapshot().text).toBe("v1\nbob queued under 2fa\n");
  expect(await readText(aliceDevice, world.documentRef(document))).toBe("v1\n");

  // Bob enrolls TOTP with `rememberDevice: true`. Enabling 2FA verifies the
  // session and re-requests sync lanes automatically, draining his held edit.
  const setup = await bobDevice.sdk.twoFactor.beginSetup();
  const recoveryCodes = await bobDevice.sdk.twoFactor.enable(
    currentTotpCode(setup.secret),
    { rememberDevice: true },
  );
  expect(recoveryCodes.length).toBeGreaterThan(0);
  expect(bobDevice.sdk.twoFactor.snapshot?.sessionVerified).toBe(true);
  expect(bobDevice.sdk.session.snapshot.twoFactorDeviceToken).not.toBeNull();

  await until(
    async () =>
      !(
        await bobDevice.sdk.containerContents
          .documentQueries()
          .listPendingWrites()
      ).some((item) => item.remoteId === document.documentId),
    "Bob's held edit to sync after enabling 2FA",
  );
  await bobDevice.idle();
  expect(
    bobDevice.transport.history
      .slice(beforeRefusal)
      .filter(documentWrite(document.documentId))
      .some(({ status }) => status === 200),
  ).toBe(true);
  expect(await readText(aliceDevice, world.documentRef(document))).toBe(
    "v1\nbob queued under 2fa\n",
  );

  // Restarting Bob's remembered device signs back in via its device token.
  const restartedBob = await world.restartDevice(bob, bobDevice);
  expect(restartedBob.sdk.session.isAuthenticated).toBe(true);
  await world.editDocument(
    bob,
    document,
    "v1\nbob queued under 2fa\nafter remembered restart\n",
    restartedBob,
  );
  expect(await readText(aliceDevice, world.documentRef(document))).toBe(
    "v1\nbob queued under 2fa\nafter remembered restart\n",
  );

  // A fresh install of Bob without a second factor is refused with
  // `TwoFactorLoginError`, and succeeds once given a recovery code.
  const freshDb = await createTestExecSql(
    `bob-2fa-fresh-${crypto.randomUUID()}`,
  );
  const freshSdk = new Tearleads({
    apiBaseUrl: restartedBob.apiOrigin,
    identityTrustDomain: restartedBob.apiOrigin,
    blobStore: createMemoryBlobStore(),
    database: {
      id: `bob-2fa-fresh-${crypto.randomUUID()}`,
      client: {
        async exec({ sql, bind, rowMode }) {
          return {
            rows: await freshDb.execSql(
              sql,
              bind,
              rowMode ? { rowMode } : undefined,
            ),
          };
        },
      },
    },
    logger: { log: () => undefined, logError: () => undefined },
  });
  try {
    await freshSdk.identity.setKeyPairs(bob.keys);
    const refusal = await freshSdk.session
      .login()
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(TwoFactorLoginError);
    expect((refusal as TwoFactorLoginError).code).toBe("two_factor_required");

    const [recoveryCode] = recoveryCodes;
    if (!recoveryCode) throw new Error("Expected at least one recovery code");
    expect(
      await freshSdk.session.login(undefined, {
        code: recoveryCode,
        method: "recovery_code",
        rememberDevice: false,
      }),
    ).toBe(true);
    const status = await freshSdk.twoFactor.status();
    expect(status.enabled).toBe(true);
    expect(status.sessionVerified).toBe(true);
    expect(status.recoveryCodesRemaining).toBe(recoveryCodes.length - 1);
  } finally {
    freshSdk.dispose();
    freshDb.close();
  }
  expectNoSecurityIncidents(world);
}, 240_000);
