import { expect, test } from "bun:test";
import {
  authChallengeSigningBytes,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  sign,
  toFingerprint,
} from "@tearleads/crypto";
import type { PutKeyPackageBackupRequest } from "@tearleads/validators/request";
import type {
  KeyPackageBackupResponse,
  ListKeyPackageBackupsResponse,
} from "@tearleads/validators/response";
import invariant from "invariant";
import {
  requestChallenge,
  submitRegistration,
  submitVerify,
} from "../../../test/helpers/api";
import { routeApp } from "../../routeApp";

interface RegisteredTestUser {
  readonly fingerprint: string;
  readonly token: string;
}

function backupRequest(
  input: Partial<PutKeyPackageBackupRequest> & {
    readonly credentialId?: string | undefined;
  } = {},
): PutKeyPackageBackupRequest {
  const backupId = input.backupId ?? crypto.randomUUID();
  const credentialId = input.credentialId ?? `credential:${backupId}`;

  return {
    backupId,
    backupVersion: input.backupVersion ?? 1,
    credential: input.credential ?? {
      id: credentialId,
      publicKey: `public-key:${credentialId}`,
      publicKeyAlgorithm: -7,
      transports: ["internal"],
      type: "public-key",
    },
    envelope: input.envelope ?? {
      ciphertext: `ciphertext:${backupId}`,
      encryptionSuite: "aes-256-gcm",
      format: "tearleads.identity-key-package.passkey-backup",
      iv: `iv:${backupId}`,
      version: 1,
    },
    kdfSuite: input.kdfSuite ?? "webauthn-prf-hkdf-sha256",
    prfSalt: input.prfSalt ?? `salt:${backupId}`,
    prfSaltVersion: 1,
    signingKeyFingerprint: input.signingKeyFingerprint ?? "a".repeat(64),
  };
}

async function registerAndAuthenticate(): Promise<RegisteredTestUser> {
  const signingKeys = generateSigningSeedAndKeyPair();
  const kemKeys = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signingKeys.signingPublicKey);

  const registerRes = await submitRegistration(
    signingKeys.signingPublicKey,
    signingKeys.signingPrivateKey,
    kemKeys.publicKey,
  );
  expect(registerRes.status).toBe(200);

  const challengeRes = await requestChallenge(fingerprint);
  const { challenge } = await challengeRes.json();
  invariant(typeof challenge === "string", "expected challenge string");
  const signature = sign(
    authChallengeSigningBytes({ challengeHex: challenge, fingerprint }),
    signingKeys.signingPrivateKey,
  );
  const verifyRes = await submitVerify(fingerprint, signature);
  expect(verifyRes.status).toBe(200);
  const body = await verifyRes.json();
  invariant(typeof body.token === "string", "expected token string");

  return {
    fingerprint,
    token: body.token,
  };
}

function backupPath(backupId: string): string {
  return `/auth/key-package-backups/${encodeURIComponent(backupId)}`;
}

function credentialPath(credentialId: string): string {
  return `/auth/key-package-backups/by-credential/${encodeURIComponent(
    credentialId,
  )}`;
}

async function putBackup(
  token: string,
  request: PutKeyPackageBackupRequest,
): Promise<Response> {
  return routeApp.request(backupPath(request.backupId), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
}

test("stores encrypted key package backups without requiring plaintext", async () => {
  const user = await registerAndAuthenticate();
  const request = backupRequest({
    credentialId: "credential/id with space",
    signingKeyFingerprint: user.fingerprint,
  });

  const putRes = await putBackup(user.token, request);
  expect(putRes.status).toBe(200);
  const stored = (await putRes.json()) as KeyPackageBackupResponse;
  expect(stored).toMatchObject({
    backupId: request.backupId,
    credential: request.credential,
    envelope: request.envelope,
    kdfSuite: request.kdfSuite,
    prfSalt: request.prfSalt,
    signingKeyFingerprint: user.fingerprint,
  });
  expect("keyPackage" in stored).toBe(false);

  const listRes = await routeApp.request("/auth/key-package-backups", {
    headers: { Authorization: `Bearer ${user.token}` },
  });
  expect(listRes.status).toBe(200);
  const listBody = (await listRes.json()) as ListKeyPackageBackupsResponse;
  expect(listBody.backups.map((backup) => backup.backupId)).toContain(
    request.backupId,
  );

  const credentialRes = await routeApp.request(
    credentialPath(request.credential.id),
  );
  expect(credentialRes.status).toBe(200);
  expect(await credentialRes.json()).toMatchObject({
    backupId: request.backupId,
    envelope: request.envelope,
  });
});

test("requires authentication to write key package backups", async () => {
  const request = backupRequest();

  const res = await routeApp.request(backupPath(request.backupId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  expect(res.status).toBe(401);
});

test("deletes only backups owned by the authenticated user", async () => {
  const user = await registerAndAuthenticate();
  const request = backupRequest({ signingKeyFingerprint: user.fingerprint });
  expect((await putBackup(user.token, request)).status).toBe(200);

  const deleteRes = await routeApp.request(backupPath(request.backupId), {
    method: "DELETE",
    headers: { Authorization: `Bearer ${user.token}` },
  });
  expect(deleteRes.status).toBe(200);
  expect(await deleteRes.json()).toEqual({ message: "ok" });

  const credentialRes = await routeApp.request(
    credentialPath(request.credential.id),
  );
  expect(credentialRes.status).toBe(404);
});

test("rejects cross-user key package backup overwrite attempts", async () => {
  const firstUser = await registerAndAuthenticate();
  const secondUser = await registerAndAuthenticate();
  const firstRequest = backupRequest({
    signingKeyFingerprint: firstUser.fingerprint,
  });
  expect((await putBackup(firstUser.token, firstRequest)).status).toBe(200);

  const sameBackupId = backupRequest({
    backupId: firstRequest.backupId,
    credentialId: "second-user-credential",
    signingKeyFingerprint: secondUser.fingerprint,
  });
  const sameBackupRes = await putBackup(secondUser.token, sameBackupId);
  expect(sameBackupRes.status).toBe(403);

  const sameCredential = backupRequest({
    credentialId: firstRequest.credential.id,
    signingKeyFingerprint: secondUser.fingerprint,
  });
  const sameCredentialRes = await putBackup(secondUser.token, sameCredential);
  expect(sameCredentialRes.status).toBe(403);
});
