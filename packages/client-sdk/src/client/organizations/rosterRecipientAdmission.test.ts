import { expect, spyOn, test } from "bun:test";
import { createMockApiClient } from "@tearleads/test-utils";
import {
  createInternalRuntimeFixture,
  createWorkflowInputFixture,
} from "../../../test/helpers/internalRuntimeFixtures";
import { DatabaseUnavailableError } from "../../data/sync/databaseUnavailable";
import { UnverifiedUserIdentityError } from "../../data/trustedUserIdentity";
import {
  evidence,
  GOOD_KEY,
  membersHistory,
  pin,
  VERIFIED_ADMIN_A,
} from "../../workflows/organizations/memberships/rosterAdmission.testFixtures";
import type { ContainerContents } from "../containerContents";
import { createOrganizations } from ".";
import {
  requireGroupMemberAdmission,
  requireShareRecipient,
} from "./recipientAdmission";
import * as adapter from "./rosterAdmissionEvidence";

async function fixtureRuntime() {
  const fixture = await membersHistory([
    { members: { "admin-a": "c".repeat(64) }, signer: "admin-a" },
    {
      members: { "admin-a": "c".repeat(64), carol: GOOD_KEY },
      signer: "admin-a",
    },
  ]);
  const served = evidence(fixture, {
    ...VERIFIED_ADMIN_A,
    carol: await pin("carol", false),
  });
  const runtime = createWorkflowInputFixture({
    apiClient: createMockApiClient({}),
    execSql: async () => [],
    auth: { userId: "admin-a", organizationId: "org-1" },
    resolveTrustedUserIdentity: async () => {
      throw new Error("Replaced below");
    },
  });
  // Only the I/O adapter is replaced: the real bounded admission runs.
  const service = createInternalRuntimeFixture(() => runtime);
  service.identityLinks.requireVerified = async () => {
    throw new UnverifiedUserIdentityError("carol");
  };
  const resolver = spyOn(
    runtime,
    "resolveTrustedUserIdentity",
  ).mockResolvedValue(null);
  const create = spyOn(
    adapter,
    "createRosterAdmissionEvidence",
  ).mockReturnValue(served);
  // Observing the candidate is structural, not the admission being tested.
  const { createTestTrustedUserIdentity } = await import(
    "../../../test/helpers/trustedUserIdentity"
  );
  resolver.mockResolvedValue(
    createTestTrustedUserIdentity({
      userId: "carol",
      signingPublicKey: new Uint8Array(),
      signingKeyFingerprint: "carol-signing",
    }),
  );
  return {
    fixture,
    runtime,
    service,
    restore: () => {
      resolver.mockRestore();
      create.mockRestore();
    },
  };
}

for (const access of ["read", "write", "admin"] as const) {
  test(`full roster identity admits a ${access} share`, async () => {
    const { runtime, service, restore } = await fixtureRuntime();
    try {
      await expect(
        requireShareRecipient(service, runtime.infra.execSql, "carol", access),
      ).resolves.toBeUndefined();
    } finally {
      restore();
    }
  });
}

test("an existing roster member passes group-add admission without a direct link", async () => {
  const { service, restore } = await fixtureRuntime();
  try {
    const organizations = createOrganizations(
      service,
      {} as ContainerContents,
      () => {
        throw new Error("Unused reconciler");
      },
    );
    // Admission succeeds, then this fixture's missing signing keys stop the write.
    await expect(
      organizations.addUserToGroup({
        targetUserId: "carol",
        groupId: "other-group",
        expectedGroupName: "Other",
      }),
    ).rejects.not.toBeInstanceOf(UnverifiedUserIdentityError);
  } finally {
    restore();
  }
});

test("a pending share cannot admit into a replacement database", async () => {
  const { runtime, service, restore } = await fixtureRuntime();
  let current = runtime;
  const input = spyOn(service, "workflowInput").mockImplementation(
    () => current,
  );
  const verification = spyOn(
    service.identityLinks,
    "requireVerified",
  ).mockImplementation(async () => {
    current = {
      ...runtime,
      infra: { ...runtime.infra, execSql: async () => [] },
    };
    throw new UnverifiedUserIdentityError("carol");
  });
  try {
    await expect(
      requireShareRecipient(service, runtime.infra.execSql, "carol", "admin"),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
  } finally {
    verification.mockRestore();
    input.mockRestore();
    restore();
  }
});

test("a group-add proof cannot be reused in a replacement database", async () => {
  const { fixture, runtime, service, restore } = await fixtureRuntime();
  let current = runtime;
  const input = spyOn(service, "workflowInput").mockImplementation(
    () => current,
  );
  try {
    const admission = await requireGroupMemberAdmission(
      service,
      runtime.infra.execSql,
      "carol",
    );
    const head = fixture.entries.at(-1);
    if (!head) throw new Error("Missing fixture head");
    current = {
      ...runtime,
      infra: { ...runtime.infra, execSql: async () => [] },
    };
    await expect(
      admission({
        currentState: head.state,
        currentProjection: head.projection,
      }),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
  } finally {
    input.mockRestore();
    restore();
  }
});

test("a roster proof cannot outlive its runtime identity trust domain", async () => {
  const { fixture, runtime, service, restore } = await fixtureRuntime();
  let current = runtime;
  const input = spyOn(service, "workflowInput").mockImplementation(
    () => current,
  );
  try {
    const admission = await requireGroupMemberAdmission(
      service,
      runtime.infra.execSql,
      "carol",
    );
    const head = fixture.entries.at(-1);
    if (!head) throw new Error("Missing fixture head");
    current = { ...runtime, identityTrustDomain: "https://other.example.test" };
    await expect(
      admission({
        currentState: head.state,
        currentProjection: head.projection,
      }),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
  } finally {
    input.mockRestore();
    restore();
  }
});

test("a roster group-add proof refuses removal/re-addition and demands a link at fresh enrollment", async () => {
  const { fixture, runtime, service, restore } = await fixtureRuntime();
  try {
    const admission = await requireGroupMemberAdmission(
      service,
      runtime.infra.execSql,
      "carol",
    );
    const current = fixture.entries.at(-1);
    if (!current) throw new Error("Missing fixture head");
    await expect(
      admission({
        currentState: current.state,
        currentProjection: current.projection,
      }),
    ).resolves.toBeUndefined();
    await expect(
      admission({
        currentState: { ...current.state, stateHash: "changed-head" },
        currentProjection: current.projection,
      }),
    ).rejects.toBeInstanceOf(UnverifiedUserIdentityError);
    await expect(
      admission({ currentState: current.state, currentProjection: [] }),
    ).rejects.toBeInstanceOf(UnverifiedUserIdentityError);
  } finally {
    restore();
  }
});
