import { expect, test } from "bun:test";
import { ApiClient } from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { quietLogger } from "../../test/helpers/clientTestSupport";
import { Tearleads } from "./Tearleads";

test("Tearleads wires workflow security incidents to durable host callbacks", async () => {
  const { close, execSql } = await createTestExecSql(
    "tearleads-security-incident-wiring",
  );
  const callbackCodes: string[] = [];
  const sdk = new Tearleads({
    apiBaseUrl: "https://api.example.test",
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
    await expect(
      sdk.userIdentities.resolve("11111111-1111-4111-8111-111111111111"),
    ).rejects.toBe(error);

    expect(callbackCodes).toEqual(["equivocation"]);
    expect(await sdk.securityIncidents.list()).toEqual([
      expect.objectContaining({
        code: "equivocation",
        operation: "user.identity.resolve",
      }),
    ]);
  } finally {
    sdk.dispose();
    await close();
  }
});
