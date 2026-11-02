import { expect, test } from "bun:test";
import type {
  OrganizationDirectoryUser,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import type { RosterProfileNames } from "../../../stores/org-manager/profileDocuments";
import { ORG_MANAGER_LABELS } from "../labels";
import { seedImportedRosterProfile } from "./seedImportedRosterProfile";

const NAMES: RosterProfileNames = { firstName: "Ada", lastName: "Lovelace" };

const ROSTER_USER: OrganizationDirectoryUser = {
  createdAt: "2026-05-20T12:00:00.000Z",
  disabledAt: null,
  disabledByUserId: null,
  encapsulationKeyFingerprint: "encapsulation-fingerprint",
  encapsulationPublicKey: "encapsulation-public-key",
  isPersonalOrganizationOwner: false,
  isSelf: false,
  joinedAt: "2026-05-20T12:00:00.000Z",
  leaveRequest: null,
  profileDocumentId: null,
  signingKeyFingerprint: "signing-fingerprint",
  signingPublicKey: "signing-public-key",
  status: "active",
  updatedAt: "2026-05-20T12:00:00.000Z",
  userId: "roster-user",
};

function detailFor(user: OrganizationDirectoryUser): OrganizationUserDetail {
  return {
    grants: { directGrants: [], groupGrants: [] },
    groups: [],
    organizationId: "organization-1",
    user,
  };
}

function createHarness(options: {
  detail: OrganizationUserDetail | null;
  ensured: Array<OrganizationDirectoryUser | null>;
}) {
  const errors: Array<string | null> = [];
  const ensureCalls: Array<{
    names: RosterProfileNames | undefined;
    userId: string;
  }> = [];
  let refreshCount = 0;
  const seed = () =>
    seedImportedRosterProfile({
      isOperationActive: () => true,
      names: NAMES,
      operationOrganizationId: "organization-1",
      orgManagerActions: {
        ensureRosterProfileDocument: async (user, names) => {
          ensureCalls.push({ names, userId: user.userId });
          return options.ensured.shift() ?? null;
        },
        loadUserDetail: async () => options.detail,
      },
      refreshDirectoryAndGroups: async () => {
        refreshCount += 1;
        return { didLoad: false, groupId: null };
      },
      setError: (error) => {
        errors.push(typeof error === "function" ? error(null) : error);
      },
      userId: ROSTER_USER.userId,
    });
  return {
    ensureCalls,
    errors,
    refreshCount: () => refreshCount,
    seed,
  };
}

test("seeds the dialog's names into a new member's roster profile", async () => {
  const harness = createHarness({
    detail: detailFor(ROSTER_USER),
    ensured: [{ ...ROSTER_USER, profileDocumentId: "profile-1" }],
  });

  expect(await harness.seed()).toBe(true);
  expect(harness.ensureCalls).toEqual([
    { names: NAMES, userId: ROSTER_USER.userId },
  ]);
  expect(harness.refreshCount()).toBe(1);
  expect(harness.errors).toEqual([]);
});

test("leaves a member's existing roster profile untouched", async () => {
  const harness = createHarness({
    detail: detailFor({ ...ROSTER_USER, profileDocumentId: "existing" }),
    ensured: [],
  });

  expect(await harness.seed()).toBe(true);
  expect(harness.ensureCalls).toEqual([]);
  expect(harness.refreshCount()).toBe(0);
  expect(harness.errors).toEqual([]);
});

test("keeps the dialog open when the member's detail is unreadable", async () => {
  const harness = createHarness({ detail: null, ensured: [] });

  expect(await harness.seed()).toBe(false);
  expect(harness.ensureCalls).toEqual([]);
  expect(harness.errors).toEqual([
    ORG_MANAGER_LABELS.failedCreateProfileDocument,
  ]);
});

test("a failed profile creation reports an error and a retry creates it", async () => {
  const harness = createHarness({
    detail: detailFor(ROSTER_USER),
    ensured: [null, { ...ROSTER_USER, profileDocumentId: "profile-1" }],
  });

  expect(await harness.seed()).toBe(false);
  expect(harness.errors).toEqual([
    ORG_MANAGER_LABELS.failedCreateProfileDocument,
  ]);
  expect(harness.refreshCount()).toBe(0);

  expect(await harness.seed()).toBe(true);
  expect(harness.ensureCalls).toEqual([
    { names: NAMES, userId: ROSTER_USER.userId },
    { names: NAMES, userId: ROSTER_USER.userId },
  ]);
  expect(harness.refreshCount()).toBe(1);
});
