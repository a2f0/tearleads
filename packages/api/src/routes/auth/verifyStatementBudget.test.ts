import { expect, test } from "bun:test";
import { withDatabaseStatementCounter } from "@tearleads/api-shared/postgres";
import { authChallengeSigningBytes, sign } from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { requestChallenge, submitVerify } from "../../../test/helpers/api";
import { registerUser } from "../../../test/helpers/registerUser";

test("login stays within its statement budget", async () => {
  const user = createTestUser();
  await registerUser(user);
  const challengeResponse = await requestChallenge(user.fingerprint);
  expect(challengeResponse.status).toBe(200);
  const { challenge } = await challengeResponse.json();
  const signature = sign(
    authChallengeSigningBytes({
      apiOrigin: "http://localhost",
      challengeHex: challenge,
      fingerprint: user.fingerprint,
    }),
    user.signing.signingPrivateKey,
  );
  const counter = { statements: 0 };
  const response = await withDatabaseStatementCounter(counter, () =>
    submitVerify(user.fingerprint, signature),
  );
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.rootContainerId).toBe(user.rootContainerId);

  // Measured with PGlite, SQLite, and Postgres: 4 while the root container
  // was read after the session; 3 once it joins the user row. The suspension
  // re-read after the session is stored stays.
  expect(counter.statements).toBeLessThanOrEqual(3);
});
