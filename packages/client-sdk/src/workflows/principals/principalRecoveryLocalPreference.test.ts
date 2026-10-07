import { beforeAll, expect, test } from "bun:test";
import { KeyingVerificationError } from "@tearleads/crypto";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { PrincipalHistoryRecoveryRaceError } from "./principalHistoryRecoveryTypes";
import { recoverWithPrincipalLocalPreference } from "./principalRecoveryLocalPreference";
import { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
});

test.each([
  new PrincipalHistoryRecoveryRaceError("local pin advanced"),
  new KeyingVerificationError("missing_dependency", "local proof missing"),
])(
  "local availability loss permits bounded online recovery: %s",
  async (error) => {
    const f = await createAuthorityRecoveryFixture(history);
    try {
      const modes: boolean[] = [];
      const recovered = await recoverWithPrincipalLocalPreference(
        async (options) => {
          modes.push(options.offline === true);
          if (options.offline) throw error;
          return recoverScopedPrincipalPolicyHistory(options);
        },
        f.options,
        true,
      );
      expect(modes).toEqual([true, false]);
      expect(recovered.policy.stateHash).toBe(
        history.group.currentState.stateHash,
      );
      expect(f.requests.length).toBeGreaterThan(0);
      expect(f.requests.every((request) => request.count <= 32)).toBe(true);
    } finally {
      f.close();
    }
  },
);

test.each(["hash_mismatch", "signer_mismatch"] as const)(
  "local %s cannot trigger an online retry",
  async (code) => {
    const f = await createAuthorityRecoveryFixture(history);
    try {
      const error = new KeyingVerificationError(code, "invalid local evidence");
      const modes: boolean[] = [];
      await expect(
        recoverWithPrincipalLocalPreference(
          async (options) => {
            modes.push(options.offline === true);
            if (options.offline) throw error;
            return recoverScopedPrincipalPolicyHistory(options);
          },
          f.options,
          true,
        ),
      ).rejects.toBe(error);
      expect(modes).toEqual([true]);
      expect(f.requests).toHaveLength(0);
    } finally {
      f.close();
    }
  },
);
