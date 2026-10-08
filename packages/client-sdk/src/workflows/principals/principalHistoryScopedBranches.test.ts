import { beforeAll, expect, test } from "bun:test";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { recoverScopedPrincipalPolicyHistory } from "./recoverScopedPrincipalPolicyHistory";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

test.each(["organization", "admins"] as const)(
  "scoped recovery selects an older %s citation",
  async (kind) => {
    const fixture = await createAuthorityRecoveryFixture(history);
    try {
      const bundle =
        kind === "organization" ? history.directory : history.admin;
      const state = bundle.previousStates[15]?.state;
      if (!state) throw new Error("Missing historical citation");
      const result = await recoverScopedPrincipalPolicyHistory({
        ...fixture.options,
        reference: principalPolicyHead({ ...bundle, currentState: state }),
      });
      expect(result.policy.stateHash).toBe(bundle.currentState.stateHash);
      expect(
        result.policy.retainedHistory.map(({ state }) => state.version),
      ).toEqual(kind === "organization" ? [1, 16, 66] : [16, 66]);
      expect(result.dependencies.map((policy) => policy.principalId)).toEqual(
        kind === "organization" ? [] : [history.organizationId],
      );
      expect(
        fixture.requests.every(
          (request) =>
            request.principalId !== history.group.currentState.principalId,
        ),
      ).toBe(true);
    } finally {
      fixture.close();
    }
  },
);

test("scoped recovery ignores caller-supplied verification controls", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const result = await recoverScopedPrincipalPolicyHistory({
      ...fixture.options,
      ...{
        historyVerification: "direct-admins" as const,
        loadExternalAuthority: async () => {
          throw new Error("Caller authority must not participate");
        },
      },
    });
    expect(result.policy.stateHash).toBe(history.group.currentState.stateHash);
  } finally {
    fixture.close();
  }
});

test("directory discovery cannot change the requested principal identity", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const client = fixture.options.apiClient;
    const recovered = await recoverScopedPrincipalPolicyHistory({
      ...fixture.options,
      reference: principalPolicyHead(history.directory),
      apiClient: {
        async *getPrincipalPolicyPages(...args) {
          for await (const result of client.getPrincipalPolicyPages(...args)) {
            if (result.ok && !args[2]?.stateHash) {
              // Simulate a custom transport missing ApiClient's identity guard.
              const data = structuredClone(result.data);
              data.currentState.principalType = "group";
              data.currentState.principalId =
                history.group.currentState.principalId;
              yield { ...result, data };
            } else yield result;
          }
        },
      },
    });
    expect(recovered.policy.stateHash).toBe(
      history.directory.currentState.stateHash,
    );
    expect(
      fixture.requests.every(
        (request) => request.principalId === history.organizationId,
      ),
    ).toBe(true);
  } finally {
    fixture.close();
  }
});

test("an organization reference outside the requested scope fails before discovery", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    await expect(
      recoverScopedPrincipalPolicyHistory({
        ...fixture.options,
        reference: {
          ...principalPolicyHead(history.directory),
          principalId: crypto.randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    expect(fixture.requests).toEqual([]);
  } finally {
    fixture.close();
  }
});

test("an organization citation beyond discovery gets one fresh directory read", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const directory = await history.extend(history.directory, 67);
    fixture.controls.mutate = (page) => {
      if (page.currentState.principalId === history.organizationId)
        fixture.policies.set(history.organizationId, directory);
    };
    const result = await recoverScopedPrincipalPolicyHistory({
      ...fixture.options,
      reference: principalPolicyHead(directory),
    });
    expect(result.policy.stateHash).toBe(directory.currentState.stateHash);
    expect(fixture.requests.map((request) => request.afterVersion)).toEqual([
      0, 0, 0, 32, 64,
    ]);
  } finally {
    fixture.close();
  }
});

test("a directory remaining behind the reference stops after one refresh", async () => {
  const fixture = await createAuthorityRecoveryFixture(history);
  try {
    const group = await history.extend(history.group, 67);
    await expect(
      recoverScopedPrincipalPolicyHistory({
        ...fixture.options,
        reference: principalPolicyHead(group),
      }),
    ).rejects.toMatchObject({ code: "stale_predecessor" });
    expect(fixture.requests.map((request) => request.afterVersion)).toEqual([
      0, 0, 32, 64, 0, 65,
    ]);
    expect(
      fixture.requests.every(
        (request) => request.principalId === history.organizationId,
      ),
    ).toBe(true);
  } finally {
    fixture.close();
  }
});
