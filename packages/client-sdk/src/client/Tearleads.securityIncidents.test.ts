import { expect, test } from "bun:test";
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
    database: { execSql },
    logger: quietLogger,
    onSecurityIncident: (incident) => callbackCodes.push(incident.code),
  });

  try {
    await sdk.runtime
      .input()
      .util.reportSecurityIncident(
        new KeyingVerificationError("equivocation", "server conflict"),
        {
          objectId: "user-1",
          objectKind: "user",
          operation: "user.identity.resolve",
        },
      );

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
