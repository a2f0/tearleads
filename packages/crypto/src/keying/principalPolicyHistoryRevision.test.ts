import { expect, test } from "bun:test";
import { restorePrincipalPolicyHistoryVerifier } from "./principalPolicyHistory";
import { normalizePrincipalHistoryInput } from "./principalPolicyHistoryChecks";
import { PRINCIPAL_HISTORY_VERIFICATION_REVISION } from "./principalPolicyHistoryPage";
import {
  ownPrincipalHistoryProgressProtection,
  sealPrincipalHistoryProgress,
} from "./principalPolicyHistoryProgressProtection";

test("progress from different verification rules cannot resume", async () => {
  const input = {
    principalType: "group" as const,
    principalId: "revision-test",
  };
  const protection = {
    localKey: crypto.getRandomValues(new Uint8Array(32)),
    context: "same-operation",
  };
  const plaintext = JSON.stringify({
    previous: null,
    latestAuthority: null,
    checkpointHash: null,
    retained: [],
  });
  const current = await sealPrincipalHistoryProgress(
    plaintext,
    ownPrincipalHistoryProgressProtection(
      normalizePrincipalHistoryInput(input),
      protection,
      PRINCIPAL_HISTORY_VERIFICATION_REVISION,
    ),
  );
  expect(
    (await restorePrincipalPolicyHistoryVerifier(input, current, protection))
      .ok,
  ).toBe(true);
  const saved = await sealPrincipalHistoryProgress(
    plaintext,
    ownPrincipalHistoryProgressProtection(
      normalizePrincipalHistoryInput(input),
      protection,
      PRINCIPAL_HISTORY_VERIFICATION_REVISION + 1,
    ),
  );
  const result = await restorePrincipalPolicyHistoryVerifier(
    input,
    saved,
    protection,
  );
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe("hash_mismatch");
  const stale = await restorePrincipalPolicyHistoryVerifier(
    input,
    saved.replace(/^v2\./, "v1."),
    protection,
  );
  expect(stale.ok).toBe(false);
  if (!stale.ok) expect(stale.error.code).toBe("invalid_shape");
});

test("separate operations use separate progress encryption keys", () => {
  const input = normalizePrincipalHistoryInput({
    principalType: "group",
    principalId: "key-scope",
  });
  const localKey = crypto.getRandomValues(new Uint8Array(32));
  const first = ownPrincipalHistoryProgressProtection(input, {
    localKey,
    context: "first",
  });
  const second = ownPrincipalHistoryProgressProtection(input, {
    localKey,
    context: "second",
  });
  try {
    expect(first.key).not.toEqual(second.key);
  } finally {
    first.key.fill(0);
    second.key.fill(0);
    localKey.fill(0);
  }
});
