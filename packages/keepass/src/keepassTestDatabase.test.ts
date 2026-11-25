import { expect, test } from "bun:test";
import { createKeepassTestDatabase } from "./keepassTestDatabase";
import { readKeepassDatabase } from "./readKeepassDatabase";

test("a generated test database reads back, its recycle bin left out", async () => {
  const bytes = await createKeepassTestDatabase({
    name: "Generated",
    password: "pw",
    root: {
      name: "Root",
      entries: [
        {
          fields: { Title: "Router", "Serial number": "SN-1" },
          protectedFields: { Password: "hunter2", PIN: "0000" },
          tags: ["home"],
        },
      ],
      groups: [{ name: "Work", groups: [{ name: "Empty" }] }],
    },
  });

  const database = await readKeepassDatabase(bytes, { password: "pw" });
  expect(database.name).toBe("Generated");
  expect(database.skipped).toEqual({ recycledEntries: 1, recycledGroups: 1 });
  expect(database.root.groups.map((group) => group.name)).toEqual(["Work"]);
  expect(database.root.groups[0]?.groups.map((group) => group.name)).toEqual([
    "Empty",
  ]);
  const [entry] = database.root.entries;
  expect(entry?.password).toBe("hunter2");
  expect(entry?.tags).toEqual(["home"]);
  expect(entry?.customFields).toEqual([
    { name: "Serial number", protected: false, value: "SN-1" },
    { name: "PIN", protected: true, value: "0000" },
  ]);
});
