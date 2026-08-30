import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { clientSqlTables } from "../../data/sqlite/schema";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { runOrganizationPresentationRead } from "../organizations/organizationPresentationAccessState";
import { clearRemoteSyncState } from "./remoteReset";

test("remote reset denies only the purged organization's presentation scope", async () => {
  const { close, execSql } = await createTestExecSql(
    "sync-remote-reset-presentation-scope",
  );
  const read = (organizationId: string) =>
    runOrganizationPresentationRead(
      {
        execSql,
        organizationId,
        requesterUserId: "requester",
      },
      "readModel",
      async () => organizationId,
    );

  try {
    await ensureSqlTables(execSql, clientSqlTables);
    await expect(read("org-purged")).resolves.toBe("org-purged");
    await expect(read("org-retained")).resolves.toBe("org-retained");

    await clearRemoteSyncState(execSql, { organizationId: "org-purged" });

    await expect(read("org-purged")).resolves.toBeNull();
    await expect(read("org-retained")).resolves.toBe("org-retained");
  } finally {
    close();
  }
});
