import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { createMockApiClient, createTestExecSql } from "@tearleads/test-utils";
import { createWorkflowInputFixture } from "./internalRuntimeFixtures";
import { repairProtectionLease } from "./principalPolicyRepair";

/** Valid writer inputs, with exactly one required recovery capability absent. */
export async function missingPrincipalRecoveryFixture(
  missing: "custody" | "pages",
  organizationId = "organization-1",
) {
  const sqlite = await createTestExecSql("missing-principal-recovery");
  const calls: string[] = [];
  const apiClient = new Proxy(createMockApiClient(), {
    get(target, property) {
      if (missing === "pages" && property === "getPrincipalPolicyPages")
        return undefined;
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      return () => {
        calls.push(`api:${String(property)}`);
        throw new Error(`Unexpected API call: ${String(property)}`);
      };
    },
  });
  const execSql = new Proxy(sqlite.execSql, {
    apply(target, receiver, args: Parameters<typeof sqlite.execSql>) {
      calls.push(`sql:${args[0]}`);
      return Reflect.apply(target, receiver, args);
    },
  });
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const runtime = {
    ...createWorkflowInputFixture({
      apiClient,
      execSql,
      auth: { organizationId, userId: "remaining-admin" },
    }),
    crypto: {
      signingKeyPair,
      signingFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
      encapsulationKeyPair: generateKemSeedAndKeyPair(),
    },
    ...(missing === "pages"
      ? { withPrincipalHistoryProtection: repairProtectionLease() }
      : {}),
  };
  return { runtime, calls, close: sqlite.close };
}
