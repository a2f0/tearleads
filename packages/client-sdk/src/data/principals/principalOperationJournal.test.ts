import { expect, test } from "bun:test";
import { principalMutationJournalFixture } from "../../../test/helpers/principalMutationJournalFixture";
import {
  openPrincipalMutation,
  sealPrincipalMutation,
} from "./principalMutationJournal";

test.each(["group-create", "group-delete", "organization"] as const)(
  "journal authenticates the complete %s operation and retains its route",
  async (kind) => {
    const fixture = await principalMutationJournalFixture();
    const { groupId, request } = fixture.mutation;
    const mutation =
      kind === "group-create"
        ? {
            kind,
            groupId,
            request: {
              groupId,
              initialGroupPolicy: request.groupPolicy,
              organizationPolicy: request.organizationPolicy,
            },
          }
        : kind === "group-delete"
          ? {
              kind,
              groupId,
              request: { organizationPolicy: request.organizationPolicy },
            }
          : { kind, groupId: null, request: request.organizationPolicy };
    const row = await sealPrincipalMutation({ ...fixture, mutation });
    const read = () =>
      openPrincipalMutation({
        scope: fixture.scope,
        row,
        signingPublicKey: fixture.signingKeyPair.signingPublicKey,
      });
    expect(await read()).toEqual(mutation);
    const original = row.serializedRequest;
    row.serializedRequest = original.replace(kind, "unknown-operation");
    await expect(read()).rejects.toThrow("could not be authenticated");
    row.serializedRequest = original.replace(
      request.organizationPolicy.encryptedPayload.ciphertext,
      "substituted-ciphertext",
    );
    await expect(read()).rejects.toThrow("could not be authenticated");
    row.serializedRequest = original;
    expect(await read()).toEqual(mutation);
  },
);
