import { beforeAll, expect, test } from "bun:test";
import { initializeApiDatabase, routeApp } from "@tearleads/api/test-runtime";
import {
  APP_DOCUMENT_PROJECTOR_DEFINITIONS,
  continuityGroups,
  loadContinuityAssets,
} from "app/continuity";
import { registerCliTestAccount } from "./registerCliAccount.testUtils";
import { memberRecoveryKey, seedRoster } from "./seedRoster";
import { type CliSession, withSession } from "./session";

let apiBaseUrl = "";

beforeAll(async () => {
  await initializeApiDatabase();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => routeApp.fetch(request),
  });
  apiBaseUrl = server.url.origin;
});

async function asOwner<T>(
  seedPhrase: string,
  work: (session: CliSession) => Promise<T>,
): Promise<T> {
  return withSession(
    {
      apiBaseUrl,
      recoveryKey: seedPhrase,
      documentProjectors: APP_DOCUMENT_PROJECTOR_DEFINITIONS,
      automaticSessionRenewal: false,
    },
    work,
  );
}

test("member recovery keys are stable per owner and member", () => {
  const owner = new Uint8Array(32).fill(1);
  const other = new Uint8Array(32).fill(2);
  const rosa = memberRecoveryKey(owner, "rosa-reyes");
  expect(memberRecoveryKey(owner, "rosa-reyes")).toBe(rosa);
  expect(rosa.split(" ")).toHaveLength(24);
  expect(memberRecoveryKey(owner, "theo-reyes")).not.toBe(rosa);
  expect(memberRecoveryKey(other, "rosa-reyes")).not.toBe(rosa);
});

test("seedRoster admits each group member to the roster and the group, once", async () => {
  const { spec } = await loadContinuityAssets();
  const groups = continuityGroups(spec);
  const [family] = groups;
  if (!family || family.members.length === 0) {
    throw new Error("The pinned dataset has no group members.");
  }
  const { seedPhrase } = await registerCliTestAccount(apiBaseUrl);
  const seed = (session: CliSession) => {
    const keys = session.sdk.identity.signingKeyPair;
    if (!keys) throw new Error("Missing the owner's signing keys.");
    return seedRoster(session, {
      apiBaseUrl,
      groups,
      signingPrivateKey: keys.signingPrivateKey,
    });
  };

  const counts = { groups: groups.length, members: family.members.length };
  expect(await asOwner(seedPhrase, seed)).toEqual(counts);
  // A rerun, as from a fresh device, finds every member and writes nothing.
  expect(await asOwner(seedPhrase, seed)).toEqual(counts);

  await asOwner(seedPhrase, async ({ sdk, userId }) => {
    const state = await sdk.organizations.loadDirectoryAndGroups();
    if (!state) throw new Error("Missing the organization directory.");
    const members = state.directory.users.filter(
      (user) => user.userId !== userId,
    );
    expect(members).toHaveLength(family.members.length);
    for (const member of members) {
      expect(member.status).toBe("active");
      expect(member.profileDocumentId).not.toBeNull();
    }
    const named = state.groups.filter((group) => group.name === family.name);
    expect(named).toHaveLength(1);
    const groupId = named[0]?.groupId ?? "";
    const groupMembers = await sdk.organizations.loadGroupMembers(groupId);
    expect(groupMembers?.members.map((member) => member.userId).sort()).toEqual(
      members.map((member) => member.userId).sort(),
    );
  });
}, 180_000);
