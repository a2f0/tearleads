import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { loadVerifiedGroupSharePrincipalPolicy } from "../containers/child/sharePrincipalPolicy";
import { deleteOrganizationGroup } from "./deleteOrganizationGroup";
import { createOrganizationGroup } from "./groupCreation";

test.each([
  { name: "creation", run: createOrganizationGroup },
  { name: "deletion", run: deleteOrganizationGroup },
  { name: "sharing", run: loadVerifiedGroupSharePrincipalPolicy },
])(
  "$name resolves pending work before reading or authoring",
  async ({ run }) => {
    const events: string[] = [];
    const pending = new Error("Saved change remains unresolved");
    const api = Object.assign(
      new ApiClient("https://journal-preflight.invalid"),
      {
        async recoverPendingPrincipalMutation(organizationId: string) {
          expect(organizationId).toBe("organization");
          events.push("recover");
          throw pending;
        },
      },
    );
    api.getCurrentPrincipalPolicy = async () => {
      events.push("read");
      return null;
    };
    const signing = generateSigningSeedAndKeyPair();
    const input = {
      apiClient: api,
      execSql: async () => [],
      organizationId: "organization",
      groupId: "group",
      name: "Group",
      signerUserId: "actor",
      signingFingerprint: await toFingerprint(signing.signingPublicKey),
      signingKeyPair: signing,
      creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
      resolveTrustedUserIdentity: async () => null,
      reportSecurityIncident: async () => {},
      metadataAccess: {
        readName: async () => "Group",
        loadEncryptionKey: async () => {
          throw new Error("Unexpected metadata authoring");
        },
      },
    };
    await expect(run(input)).rejects.toBe(pending);
    expect(events).toEqual(["recover"]);
  },
);
