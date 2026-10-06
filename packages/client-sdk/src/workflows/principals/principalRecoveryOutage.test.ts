import { beforeAll, expect, test } from "bun:test";
import type { RequestFailure } from "@tearleads/api-client";
import { KeyingVerificationError } from "@tearleads/crypto";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { PrincipalPolicyHistoryReadError } from "./principalHistoryRecoveryTypes";
import { recoverWithPrincipalOutageFallback } from "./principalRecoveryOutage";
import { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);
function failure(
  kind: RequestFailure["kind"],
  code?: string,
): PrincipalPolicyHistoryReadError {
  return new PrincipalPolicyHistoryReadError({
    kind,
    code,
    ok: false,
    message: "Test read failure",
    method: "GET",
    path: "/principal",
    report: () => undefined,
    status: null,
    statusText: "",
  });
}

for (const [kind, code, recovered] of [
  ["network", undefined, true],
  ["cancelled", "principal_history_request_timed_out", true],
  ["cancelled", "principal_history_context_changed", false],
  ["shape", undefined, false],
  ["json", undefined, false],
] as const) {
  test(`${kind}/${code ?? "no-code"} ${recovered ? "reuses" : "refuses"} completed local evidence`, async () => {
    const f = await createAuthorityRecoveryFixture(history);
    try {
      await recoverScopedPrincipalPolicyHistory(f.options);
      const before = f.requests.length;
      const error = failure(kind, code);
      const result = recoverWithPrincipalOutageFallback(async () => {
        throw error;
      }, f.options);
      if (recovered) expect((await result).policy.version).toBe(66);
      else await expect(result).rejects.toBe(error);
      expect(f.requests).toHaveLength(before);
    } finally {
      f.close();
    }
  });
}

test("an outage without completed local evidence remains dependency unavailable", async () => {
  const f = await createAuthorityRecoveryFixture(history);
  try {
    await expect(
      recoverWithPrincipalOutageFallback(async () => {
        throw failure("network");
      }, f.options),
    ).rejects.toMatchObject({ name: "ProjectionDependencyUnavailableError" });
    expect(f.requests).toHaveLength(0);
  } finally {
    f.close();
  }
});

test("invalid signed evidence never falls back to completed local history", async () => {
  const f = await createAuthorityRecoveryFixture(history);
  try {
    await recoverScopedPrincipalPolicyHistory(f.options);
    const error = new KeyingVerificationError(
      "signature_mismatch",
      "Substituted signed state",
    );
    await expect(
      recoverWithPrincipalOutageFallback(async () => {
        throw error;
      }, f.options),
    ).rejects.toBe(error);
  } finally {
    f.close();
  }
});
