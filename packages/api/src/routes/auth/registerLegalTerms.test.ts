import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { users } from "@tearleads/api-shared/schema";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import {
  LEGAL_TERMS_OUTDATED_ERROR_CODE,
  LEGAL_TERMS_VERSION,
} from "@tearleads/validators/legalTerms";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import {
  createRegistrationRequestBody,
  submitRegistration,
} from "../../../test/helpers/api";
import { routeApp } from "../../routeApp";
import { LEGAL_TERMS_OUTDATED_MESSAGE } from "../../workflows/auth/registration";

async function postRegistration(body: unknown): Promise<Response> {
  return routeApp.request("/auth/register", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

test("POST /auth/register records the legal terms revision and when it was agreed to", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();

  const res = await submitRegistration(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );
  expect(res.status).toBe(200);
  const { userId } = await res.json();

  const [user] = await db
    .select({
      createdAt: users.createdAt,
      legalTermsAcceptedAt: users.legalTermsAcceptedAt,
      legalTermsVersion: users.legalTermsVersion,
    })
    .from(users)
    .where(eq(users.id, userId));
  invariant(user, "expected the registered user");
  expect(user.legalTermsVersion).toBe(LEGAL_TERMS_VERSION);
  // The registration transaction's own database time, as `createdAt` is.
  expect(user.legalTermsAcceptedAt).toBeInstanceOf(Date);
  expect(user.legalTermsAcceptedAt).toEqual(user.createdAt);
});

test("POST /auth/register refuses a revision other than the current one and creates no identity", async () => {
  const { signingPrivateKey, signingPublicKey } =
    generateSigningSeedAndKeyPair();
  const { publicKey } = generateKemSeedAndKeyPair();
  const fingerprint = await toFingerprint(signingPublicKey);
  const body = await createRegistrationRequestBody(
    signingPublicKey,
    signingPrivateKey,
    publicKey,
  );

  for (const acceptedLegalTermsVersion of ["2000-01-01", "9999-12-31"]) {
    const res = await postRegistration({ ...body, acceptedLegalTermsVersion });
    expect(res.status).toBe(409);
    // Its own code tells it from a key that is already registered.
    expect(await res.json()).toEqual({
      code: LEGAL_TERMS_OUTDATED_ERROR_CODE,
      error: LEGAL_TERMS_OUTDATED_MESSAGE,
    });
  }
  const { acceptedLegalTermsVersion: _omitted, ...withoutAgreement } = body;
  expect((await postRegistration(withoutAgreement)).status).toBe(400);

  expect(
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.fingerprint, fingerprint)),
  ).toEqual([]);
  // The same keys still register once they carry the current revision.
  expect((await postRegistration(body)).status).toBe(200);
});
