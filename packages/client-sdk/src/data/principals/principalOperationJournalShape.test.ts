import { expect, test } from "bun:test";
import { sign } from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import { principalMutationJournalFixture } from "../../../test/helpers/principalMutationJournalFixture";
import {
  openPrincipalMutation,
  sealPrincipalMutation,
} from "./principalMutationJournal";

test.each(["unsupported", "organization-group", "creation-target"] as const)(
  "an authenticated %s journal refuses an invalid operation route",
  async (failure) => {
    const fixture = await principalMutationJournalFixture();
    const row = await sealPrincipalMutation(fixture);
    const { groupId, request } = fixture.mutation;
    const mutation =
      failure === "unsupported"
        ? { ...fixture.mutation, kind: "unsupported" }
        : failure === "organization-group"
          ? {
              kind: "organization",
              groupId,
              request: request.organizationPolicy,
            }
          : {
              kind: "group-create",
              groupId,
              request: {
                groupId: crypto.randomUUID(),
                initialGroupPolicy: request.groupPolicy,
                organizationPolicy: request.organizationPolicy,
              },
            };
    row.serializedRequest = JSON.stringify(mutation);
    // Independently construct the documented signed scope. Authentication must
    // succeed so this test reaches parsing of a signed, unsupported operation.
    const scope = JSON.stringify([
      "tearleads.sdk.principal-mutation.v1",
      fixture.scope.identityTrustDomain,
      fixture.scope.organizationId,
      fixture.scope.userId,
      fixture.scope.signingFingerprint,
    ]);
    row.signature = bytesToBase64(
      sign(
        new TextEncoder().encode(
          JSON.stringify([scope, row.serializedRequest]),
        ),
        fixture.signingKeyPair.signingPrivateKey,
      ),
    );
    await expect(
      openPrincipalMutation({
        scope: fixture.scope,
        row,
        signingPublicKey: fixture.signingKeyPair.signingPublicKey,
      }),
    ).rejects.toMatchObject({ code: "invalid_shape" });
  },
);
