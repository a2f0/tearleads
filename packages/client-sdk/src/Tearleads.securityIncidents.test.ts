import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { quietLogger } from "../test/helpers/clientTestSupport";
import {
  identityLinkFixture,
  LINK_TRUST_DOMAIN,
} from "./data/trustedUserIdentity/identityLink.testFixtures";
import { Tearleads } from "./Tearleads";

test("Tearleads wires workflow security incidents to durable host callbacks", async () => {
  const { close, execSql } = await createTestExecSql(
    "tearleads-security-incident-wiring",
  );
  const callbackCodes: string[] = [];
  const sdk = new Tearleads({
    apiBaseUrl: LINK_TRUST_DOMAIN,
    database: { execSql },
    logger: quietLogger,
    onSecurityIncident: (incident) => callbackCodes.push(incident.code),
  });
  const apiClient = Reflect.get(sdk, "apiClient");
  if (!(apiClient instanceof ApiClient)) {
    throw new Error("Expected Tearleads to own an API client");
  }
  const error = new KeyingVerificationError("equivocation", "server conflict");
  apiClient.getUserIdentity = async () => {
    throw error;
  };

  try {
    expect("reportSecurityIncident" in sdk.runtime.input().util).toBe(false);
    const { link } = await identityLinkFixture();
    await expect(sdk.userIdentities.verifyLink(link)).rejects.toBe(error);

    expect(callbackCodes).toEqual(["equivocation"]);
    expect(await sdk.securityIncidents.list()).toEqual([
      expect.objectContaining({
        code: "equivocation",
        operation: "user.identity.verify_link",
      }),
    ]);
  } finally {
    sdk.dispose();
    await close();
  }
});

test("identity links report server pin conflicts but not mismatched supplied links", async () => {
  const { identityLinkFixture, LINK_TRUST_DOMAIN } = await import(
    "./data/trustedUserIdentity/identityLink.testFixtures"
  );
  const { close, execSql } = await createTestExecSql("identity-link-incidents");
  const bob = await identityLinkFixture(1);
  const replacement = await identityLinkFixture(2);
  const callbackCodes: string[] = [];
  const sdk = new Tearleads({
    apiBaseUrl: LINK_TRUST_DOMAIN,
    database: { execSql },
    logger: quietLogger,
    onSecurityIncident: (incident) => callbackCodes.push(incident.code),
  });
  const api = Reflect.get(sdk, "apiClient");
  if (!(api instanceof ApiClient)) throw new Error("Expected API client");
  let remote = bob.remote;
  api.getUserIdentity = async () => remote;
  try {
    await sdk.userIdentities.verifyLink(bob.link);
    await expect(
      sdk.userIdentities.verifyLink(replacement.link),
    ).rejects.toThrow("do not match");
    expect(callbackCodes).toEqual([]);
    expect(await sdk.securityIncidents.list()).toEqual([]);
    remote = replacement.remote;
    await expect(
      sdk.userIdentities.verifyLink(replacement.link),
    ).rejects.toThrow("Trusted user identity changed");
    expect(callbackCodes).toEqual(["equivocation"]);
    expect(await sdk.securityIncidents.list()).toEqual([
      expect.objectContaining({
        code: "equivocation",
        objectId: bob.remote.userId,
        operation: "user.identity.verify_link",
      }),
    ]);
    remote = { ...bob.remote, signingPublicKey: "invalid-key" };
    await expect(sdk.userIdentities.verifyLink(bob.link)).rejects.toThrow();
    expect(callbackCodes).toHaveLength(2);
  } finally {
    sdk.dispose();
    await close();
  }
});
