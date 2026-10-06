import { test } from "bun:test";
import { assertPrincipalHistoryAvailability } from "../helpers/principalHistoryAvailability";

const diagnosticHistoryLengthKey = "PRINCIPAL_HISTORY_THROUGH_VERSION";
const throughVersion = Number(
  process.env[diagnosticHistoryLengthKey] ?? 16_384,
);
if (!Number.isSafeInteger(throughVersion) || throughVersion < 2)
  throw new Error("Invalid diagnostic history length");

// Fixture signing plus thousands of bounded calls may exceed twenty minutes.
// The HTTP proxy still enforces 15 seconds for each response, including its body.
test(`revocation and cold historical decryption cross ${throughVersion} signed principal versions`, async () => {
  const started = performance.now();
  await assertPrincipalHistoryAvailability(throughVersion, (stage) => {
    console.info(
      `Principal history ${stage}: ${Math.round(performance.now() - started)}ms`,
    );
  });
}, 2_700_000);
