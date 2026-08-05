import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { MAX_PRINCIPAL_STATE_VERSION } from "@tearleads/validators/util";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedPrincipalState } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("the retired principal policy-history route returns 404", async () => {
  const user = createTestUser();
  await registerUser(user);
  await authenticate(user);

  const response = await routeApp.request(
    `/principals/group/${crypto.randomUUID()}/policy-history`,
    { headers: { Authorization: `Bearer ${user.token}` } },
  );

  expect(response.status).toBe(404);
});

test("a policy write past the version ceiling is rejected, not a 500", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const principalId = crypto.randomUUID();
  const signed = await createSignedPrincipalState({
    principalType: "group",
    principalId,
    members: [{ userId: actor.userId }],
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const response = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify({
        state: {
          ...signed.state,
          version: MAX_PRINCIPAL_STATE_VERSION + 1,
        },
        encryptedPayload: signed.encryptedPayload,
        projection: signed.projection,
        memberEnvelopes: signed.memberEnvelopes,
      }),
    },
  );

  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.status).toBeLessThan(500);
}, 30_000);
