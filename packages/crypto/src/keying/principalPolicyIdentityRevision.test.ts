import { expect, test } from "bun:test";
import { restorePrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import { normalizePrincipalHistoryInput } from "./principalPolicyHistoryChecks";
import {
  ownPrincipalHistoryProgressProtection,
  sealPrincipalHistoryProgress,
} from "./principalPolicyHistoryProgressProtection";

test("pre-identity-commitment verifier progress cannot bypass the new rules", async () => {
  const input = {
    principalType: "group" as const,
    principalId: "old-progress",
  };
  const protection = {
    localKey: crypto.getRandomValues(new Uint8Array(32)),
    context: "same-operation",
  };
  const saved = await sealPrincipalHistoryProgress(
    JSON.stringify({
      previous: null,
      indexFrontier: [],
      latestAuthority: null,
      checkpointHash: null,
      retained: [],
    }),
    ownPrincipalHistoryProgressProtection(
      normalizePrincipalHistoryInput(input),
      protection,
      2,
    ),
  );
  const result = await restorePrincipalPolicyHistoryVerifier(
    input,
    saved,
    protection,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("hash_mismatch");
});
