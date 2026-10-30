import { expect, test } from "bun:test";
import {
  db,
  withDatabaseStatementCounter,
} from "@tearleads/api-shared/postgres";
import {
  groups,
  organizationGroupTombstones,
} from "@tearleads/api-shared/schema";
import { readOrganizationGroupLiveness } from "./groupTombstone";

async function liveness(groupId: string) {
  const counter = { statements: 0 };
  const result = await withDatabaseStatementCounter(counter, () =>
    readOrganizationGroupLiveness({ executor: db, groupId }),
  );
  expect(counter.statements).toBe(1);
  return result;
}

test("a group's tombstone and live row are read in one statement", async () => {
  const organizationId = crypto.randomUUID();
  const [live, standalone, deleted, deletedWithRow, missing] = Array.from(
    { length: 5 },
    () => crypto.randomUUID(),
  );
  if (!live || !standalone || !deleted || !deletedWithRow || !missing)
    throw new Error("Missing fixture ids");
  await db.insert(groups).values([
    { id: live, organizationId },
    { id: standalone, organizationId: null },
    { id: deletedWithRow, organizationId },
  ]);
  await db.insert(organizationGroupTombstones).values([
    { groupId: deleted, organizationId },
    { groupId: deletedWithRow, organizationId },
  ]);

  expect(await liveness(live)).toEqual({ deleted: false, organizationId });
  expect(await liveness(standalone)).toEqual({
    deleted: false,
    organizationId: null,
  });
  expect(await liveness(missing)).toEqual({
    deleted: false,
    organizationId: null,
  });
  // A tombstone wins whether or not a groups row remains.
  expect(await liveness(deleted)).toEqual({ deleted: true });
  expect(await liveness(deletedWithRow)).toEqual({ deleted: true });
});
