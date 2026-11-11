import { expect, test } from "bun:test";
import {
  evidence,
  GOOD_KEY,
  membersHistory,
} from "./rosterAdmission.testFixtures";
import { createRosterAdmissionHistory } from "./rosterAdmissionHistory";

async function fixture() {
  const history = await membersHistory([
    { members: { "admin-a": GOOD_KEY }, signer: "admin-a" },
    { members: { "admin-a": GOOD_KEY }, signer: "admin-a" },
    {
      members: { "admin-a": GOOD_KEY, carol: GOOD_KEY },
      signer: "admin-a",
    },
  ]);
  const served = evidence(history, {});
  const { head } = await served.loadCurrentMembers();
  return { history, served, head };
}

test("a rejected page cursor cannot seed a later membership lookup", async () => {
  const { served, head } = await fixture();
  const reads: (number | undefined)[] = [];
  const scan = createRosterAdmissionHistory(head, async (selected, before) => {
    reads.push(before);
    const page = await served.loadHistoryPage(selected, before);
    // Entries v2/v3 are hash-linked to the exact head, but continuing before
    // v3 repeats v2 instead of advancing before v2. Reject the entire batch.
    return { ...page, nextBeforeVersion: 3 };
  });
  await expect(
    scan.membershipStart("carol", head.version, true),
  ).resolves.toBeNull();
  await expect(
    scan.membershipStart("carol", head.version, true),
  ).resolves.toBeNull();
  expect(reads).toEqual([undefined]);
});

test("valid pages remain shared across membership lookups", async () => {
  const { history, served, head } = await fixture();
  const first = history.entries[0];
  const enrollment = history.entries[2];
  if (!first || !enrollment) throw new Error("Missing fixture entries");
  const reads: (number | undefined)[] = [];
  const scan = createRosterAdmissionHistory(head, async (selected, before) => {
    reads.push(before);
    return served.loadHistoryPage(selected, before);
  });
  await expect(
    scan.membershipStart("carol", head.version, true),
  ).resolves.toEqual(enrollment);
  expect(reads).toEqual([undefined]);
  await expect(scan.membershipStart("admin-a", 2, false)).resolves.toEqual(
    first,
  );
  expect(reads).toEqual([undefined, 2]);
  await expect(
    scan.membershipStart("carol", head.version, true),
  ).resolves.toEqual(enrollment);
  expect(reads).toEqual([undefined, 2]);
});
