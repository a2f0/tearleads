import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { containerTableSchemas } from "../../sqlite/schema/containerSchema";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";
import { DocumentLaneRevalidationRepository } from "./documentLaneRevalidations";

let close: () => void = () => undefined;
let execSql: ExecSql;
let repository: DocumentLaneRevalidationRepository;

beforeEach(async () => {
  const database = await createTestExecSql(`lanes-${crypto.randomUUID()}`);
  close = database.close;
  execSql = database.execSql;
  repository = new DocumentLaneRevalidationRepository(execSql);
});

afterEach(() => close());

test("a request names each container once and is found by container", async () => {
  await repository.request(["a", "b", "a"]);

  expect(await repository.listOwedContainerIds()).toEqual(new Set(["a", "b"]));
  expect(
    (await repository.find(["a", "missing"])).map((found) => found.containerId),
  ).toEqual(["a"]);
  expect(await repository.find([])).toEqual([]);
  // Nothing to request is not a write.
  await repository.request([]);
});

test("a listing settles only the request it read before it began", async () => {
  await repository.request(["a"]);
  const [read] = await repository.find(["a"]);
  if (!read) throw new Error("Expected the request");

  // The tree listing is served the container's row again while that listing
  // is in flight: the request is renewed under another revision.
  await repository.request(["a"]);
  await repository.settle(read);
  expect(await repository.listOwedContainerIds()).toEqual(new Set(["a"]));

  const [renewed] = await repository.find(["a"]);
  if (!renewed) throw new Error("Expected the renewed request");
  expect(renewed.revision).not.toBe(read.revision);
  await repository.settle(renewed);
  expect(await repository.listOwedContainerIds()).toEqual(new Set());
});

test("many containers are requested and found across statements", async () => {
  const containerIds = Array.from(
    { length: 1_200 },
    (_, index) => `c-${index}`,
  );

  await repository.request(containerIds);

  expect((await repository.listOwedContainerIds()).size).toBe(1_200);
  expect((await repository.find(containerIds)).length).toBe(1_200);
});

test("requests of containers the device does not store are forgotten", async () => {
  await ensureSqlTables(execSql, containerTableSchemas);
  await execSql(
    `INSERT INTO containers
       (id, organization_id, local_created_at, local_updated_at)
     VALUES ('stored', 'org-1', '2026-01-01', '2026-01-01')`,
    [],
  );
  await repository.request(["stored", "refused"]);

  await repository.forgetUnheld();

  // A refused row was owed before it could be stored and nothing lists it.
  expect(await repository.listOwedContainerIds()).toEqual(new Set(["stored"]));
});

test("deleting a container clears the listing its lane was owed", async () => {
  const now = "2026-01-01T00:00:00.000Z";
  await sqlContainerContentsPersistence.ensureSchema(execSql);
  for (const id of ["deleted", "kept"]) {
    await execSql(
      `INSERT INTO containers
         (id, organization_id, local_created_at, local_updated_at)
       VALUES (?, 'org-1', ?, ?)`,
      [id, now, now],
    );
  }
  await repository.request(["deleted", "kept"]);

  await sqlContainerContentsPersistence.deleteContainers(execSql, [
    { containerId: "deleted", reason: "deleted", updatedAt: now },
  ]);

  // A lane that no longer exists has nothing left to list.
  expect(await repository.listOwedContainerIds()).toEqual(new Set(["kept"]));
});
