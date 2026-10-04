import { test } from "bun:test";
import { assertPrincipalHistoryAvailability } from "../../../test/helpers/principalHistoryAvailability";

test("revocation and cold historical decryption survive retained principal histories", async () => {
  await assertPrincipalHistoryAvailability(64);
}, 30_000);
