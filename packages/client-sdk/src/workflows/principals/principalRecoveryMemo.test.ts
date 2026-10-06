import { beforeAll, expect, test } from "bun:test";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import {
  createPrincipalRecoveryReader,
  type PrincipalRecoveryMemo,
} from "./principalRecoveryMemo";
import { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

test("online directory and Admins recovery cannot reuse an offline batch entry", async () => {
  const f = await createAuthorityRecoveryFixture(history);
  try {
    await recoverScopedPrincipalPolicyHistory(f.options);
    const memo: PrincipalRecoveryMemo = {
      directories: new Map(),
      admins: new Map(),
    };
    const offline = createPrincipalRecoveryReader(
      { ...f.options, offline: true },
      memo,
    );
    const before = f.requests.length;
    await offline.directory([]);
    await offline.admins(principalPolicyHead(history.admin));
    expect(f.requests).toHaveLength(before);
    const online = createPrincipalRecoveryReader(
      { ...f.options, offline: false },
      memo,
    );
    await online.directory([]);
    expect(f.requests.length).toBeGreaterThan(before);
    const directoryReads = f.requests.length;
    await online.admins(principalPolicyHead(history.admin));
    expect(f.requests.length).toBeGreaterThan(directoryReads);
  } finally {
    f.close();
  }
});

test("a failed batch recovery can retry after the transport recovers", async () => {
  const f = await createAuthorityRecoveryFixture(history);
  try {
    const memo: PrincipalRecoveryMemo = {
      directories: new Map(),
      admins: new Map(),
    };
    const reader = createPrincipalRecoveryReader(f.options, memo);
    f.controls.failureStatus = 503;
    await expect(reader.directory([])).rejects.toMatchObject({
      name: "PrincipalPolicyHistoryReadError",
    });
    delete f.controls.failureStatus;
    expect((await reader.directory([])).policy.principalId).toBe(
      history.organizationId,
    );
  } finally {
    f.close();
  }
});
