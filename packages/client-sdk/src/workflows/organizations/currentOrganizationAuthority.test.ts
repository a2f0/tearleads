import { beforeAll, expect, test } from "bun:test";
import {
  createAuthorityRecoveryFixture,
  signedAuthorityRecoveryHistory,
} from "../../../test/helpers/principalAuthorityRecovery";
import { principalPolicyHead } from "../../../test/helpers/principalPolicyFixtures";
import { ProjectionDependencyUnavailableError } from "../../data/keyingProjectionVerification/dependencyUnavailable";
import { principalPolicyCheckpoints } from "../../data/sqlite/principalPolicySchema";
import { createRuntimePrincipalPolicyCurrentResolver } from "../principals/runtimePolicyRecovery";
import { loadCurrentOrganizationAuthority } from "./currentOrganizationAuthority";

let history: Awaited<ReturnType<typeof signedAuthorityRecoveryHistory>>;
beforeAll(async () => {
  history = await signedAuthorityRecoveryHistory();
}, 30_000);

async function fixture() {
  const f = await createAuthorityRecoveryFixture(history);
  const state = { current: true, online: true };
  const resolveCurrentPolicy = createRuntimePrincipalPolicyCurrentResolver({
    apiClient: f.options.apiClient,
    infra: { execSql: f.options.execSql },
    resolveTrustedUserIdentity: f.options.resolveTrustedUserIdentity,
    state,
    util: { reportSecurityIncident: async () => {} },
    withPrincipalHistoryProtection: async (work) =>
      work({
        protection: f.options.protection,
        stillCurrent: () => state.current,
      }),
  });
  if (!resolveCurrentPolicy) throw new Error("Missing current policy resolver");
  const input = {
    execSql: f.options.execSql,
    organizationId: history.organizationId,
    organizationReference: principalPolicyHead(history.directory),
    resolveCurrentPolicy,
    stillCurrent: () => state.current,
  };
  return { ...f, state, input };
}

test("one current authority retains selected group citations and exact directory dependencies", async () => {
  const f = await fixture();
  try {
    const authority = await loadCurrentOrganizationAuthority(f.input);
    const group = await authority.readGroup(
      history.group.currentState.principalId,
      principalPolicyHead(history.created),
    );
    expect(group.current.currentPayload).toEqual(history.group.currentPayload);
    expect(group.current).not.toHaveProperty("previousStates");
    expect(
      group.policy.retainedHistory.map((entry) => entry.state.version),
    ).toEqual([1, 66]);
    expect(authority.admins.policy.stateHash).toBe(
      history.admin.currentState.stateHash,
    );
    expect(authority.directory.policy.stateHash).toBe(
      history.directory.currentState.stateHash,
    );
    expect(f.requests.every((request) => request.count <= 32)).toBe(true);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    const count = f.requests.length;
    expect(
      (await authority.readGroup(history.admin.currentState.principalId)).policy
        .stateHash,
    ).toBe(history.admin.currentState.stateHash);
    expect(f.requests).toHaveLength(count);
    await expect(authority.readGroup("foreign-group")).rejects.toThrow(
      "Group is absent from the signed organization directory",
    );
    await expect(
      authority.readGroup(
        history.group.currentState.principalId,
        principalPolicyHead(history.admin),
      ),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    expect(f.requests).toHaveLength(count);
    f.state.current = false;
    await expect(
      authority.readGroup(history.admin.currentState.principalId),
    ).rejects.toThrow("generation expired");
    await expect(
      authority.readGroup(history.group.currentState.principalId),
    ).rejects.toThrow("generation expired");
    expect(f.requests).toHaveLength(count);
  } finally {
    f.close();
  }
});

test("a group advancing after directory selection requires a fresh authority", async () => {
  const f = await fixture();
  try {
    const authority = await loadCurrentOrganizationAuthority(f.input);
    const group = await history.extend(history.group, 67);
    const directory = await history.advanceDirectory(history.directory, group);
    f.policies.set(group.currentState.principalId, group);
    f.policies.set(directory.currentState.principalId, directory);
    await expect(
      authority.readGroup(group.currentState.principalId),
    ).rejects.toBeInstanceOf(ProjectionDependencyUnavailableError);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
    const fresh = await loadCurrentOrganizationAuthority({
      ...f.input,
      organizationReference: principalPolicyHead(directory),
    });
    expect(
      (await fresh.readGroup(group.currentState.principalId)).policy.version,
    ).toBe(67);
  } finally {
    f.close();
  }
});

test("current authority rejects an organization reference outside its scope before reads", async () => {
  const f = await fixture();
  try {
    await expect(
      loadCurrentOrganizationAuthority({
        ...f.input,
        organizationId: "foreign",
      }),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    expect(f.requests).toHaveLength(0);
  } finally {
    f.close();
  }
});

test("a discovery batch keeps one signed directory view and the next batch sees its advance", async () => {
  const f = await fixture();
  try {
    const advanced = await history.advanceDirectory(
      history.directory,
      history.group,
    );
    const selected = await loadCurrentOrganizationAuthority({
      ...f.input,
      organizationReference: undefined,
      resolveCurrentPolicy: async (request) => {
        const result = await f.input.resolveCurrentPolicy(request);
        if (!request.reference)
          f.policies.set(advanced.currentState.principalId, advanced);
        return result;
      },
    });
    expect(selected.directory.policy.stateHash).toBe(
      history.directory.currentState.stateHash,
    );
    expect(
      selected.admins.dependencies.find(
        (policy) => policy.principalType === "organization",
      )?.stateHash,
    ).toBe(history.directory.currentState.stateHash);
    const next = await loadCurrentOrganizationAuthority({
      ...f.input,
      organizationReference: undefined,
    });
    expect(next.directory.policy.stateHash).toBe(
      advanced.currentState.stateHash,
    );
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("an exact projected directory reuses authenticated local current artifacts", async () => {
  const f = await fixture();
  try {
    const first = await loadCurrentOrganizationAuthority(f.input);
    await first.readGroup(history.group.currentState.principalId);
    const count = f.requests.length;
    const second = await loadCurrentOrganizationAuthority(f.input);
    const group = await second.readGroup(
      history.group.currentState.principalId,
    );
    expect(group.policy.stateHash).toBe(history.group.currentState.stateHash);
    expect(f.requests).toHaveLength(count);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("discovery and group reads share one directory and Admins recovery", async () => {
  const f = await fixture();
  try {
    const authority = await loadCurrentOrganizationAuthority({
      ...f.input,
      organizationReference: undefined,
    });
    await authority.readGroup(history.group.currentState.principalId);
    const pages = (principalId: string) =>
      f.requests
        .filter((request) => request.principalId === principalId)
        .map((request) => request.afterVersion);
    expect({
      directory: pages(history.organizationId),
      admins: pages(history.admin.currentState.principalId),
    }).toEqual({ directory: [0, 32, 64], admins: [0, 32, 64] });
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("the reused discovery page must pass signature verification", async () => {
  const f = await fixture();
  try {
    let changed = false;
    f.controls.mutate = (page) => {
      const first = page.previousStates[0];
      if (
        !changed &&
        page.currentState.principalId === history.organizationId &&
        first
      ) {
        changed = true;
        first.state.signature = history.admin.currentState.signature;
      }
    };
    await expect(
      loadCurrentOrganizationAuthority({
        ...f.input,
        organizationReference: undefined,
      }),
    ).rejects.toMatchObject({ code: "signature_mismatch" });
    expect(changed).toBe(true);
    expect(f.requests.map((request) => request.afterVersion)).toEqual([0]);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});

test("discovery continuation keeps the API client's exact artifact binding", async () => {
  const f = await fixture();
  try {
    f.controls.mutate = (page) => {
      if (
        page.currentState.principalId === history.organizationId &&
        page.historyPage.afterVersion === 32
      ) {
        page.currentPayload.ciphertext += "changed";
      }
    };
    await expect(
      loadCurrentOrganizationAuthority({
        ...f.input,
        organizationReference: undefined,
      }),
    ).rejects.toBeInstanceOf(ProjectionDependencyUnavailableError);
    expect(f.requests.map((request) => request.afterVersion)).toEqual([0, 32]);
    expect(await f.db.select().from(principalPolicyCheckpoints)).toEqual([]);
  } finally {
    f.close();
  }
});
