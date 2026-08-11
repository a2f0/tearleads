import { expect, test } from "bun:test";
import { createTestUser } from "@tearleads/bob-and-alice";
import { authenticate } from "../../../test/helpers/authenticate";
import { createSignedPrincipalState } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { routeApp } from "../../routeApp";

test("PUT principal policy rejects a principal without a backing group", async () => {
  const actor = createTestUser();
  await registerUser(actor);
  await authenticate(actor);
  const principalId = crypto.randomUUID();
  const signedState = await createSignedPrincipalState({
    members: [{ userId: actor.userId }],
    principalId,
    principalType: "group",
    signerUserId: actor.userId,
    signerUserKeyFingerprint: actor.fingerprint,
    signingPrivateKey: actor.signing.signingPrivateKey,
  });

  const response = await routeApp.request(
    `/principals/group/${principalId}/policy`,
    {
      body: JSON.stringify({
        encryptedPayload: signedState.encryptedPayload,
        grants: signedState.grants,
        memberEnvelopes: signedState.memberEnvelopes,
        projection: signedState.projection,
        state: signedState.state,
      }),
      headers: {
        Authorization: `Bearer ${actor.token}`,
        "Content-Type": "application/json",
      },
      method: "PUT",
    },
  );

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: "Principal policy target not found",
  });
});
