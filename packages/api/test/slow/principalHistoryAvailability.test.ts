import { test } from "bun:test";
import { assertPrincipalHistoryAvailability } from "../helpers/principalHistoryAvailability";

test("revocation and cold historical decryption cross 16,384 signed principal versions", async () => {
  const started = performance.now();
  await assertPrincipalHistoryAvailability(16_384, (stage) => {
    console.info(
      `Principal history ${stage}: ${Math.round(performance.now() - started)}ms`,
    );
  });
}, 1_200_000);
