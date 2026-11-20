import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createExecSql } from "../../sqlite/sqlSchema";
import { DocumentDiscoveryEvidenceRepository } from "./documentDiscoveryEvidencePersistence";

for (const action of ["stage", "acknowledge", "saveHead"] as const) {
  test(`retiring a discovery during its generation read rolls back ${action}`, async () => {
    const sqlite = await createTestExecSql(`cancel-${action}`);
    const controller = new AbortController();
    let retire = false;
    const exec = createExecSql({
      async exec({ sql, bind, rowMode }) {
        const rows =
          rowMode === "array"
            ? await sqlite.execSql(sql, bind, { rowMode })
            : await sqlite.execSql(sql, bind);
        if (retire && /from "document_discovery_sequence"/i.test(sql))
          controller.abort(new Error("Retired discovery"));
        return { rows };
      },
    });
    const repo = new DocumentDiscoveryEvidenceRepository(
      exec,
      Date.now,
      controller.signal,
    );
    const candidate = {
      accessEpoch: 1,
      containerId: "folder",
      documentId: "remote",
      createdAt: new Date().toISOString(),
      linkedContainerIds: ["folder"],
      listedContainerIds: ["folder"],
    };
    try {
      const generation = await repo.begin();
      if (action === "acknowledge") await repo.stage([candidate], generation);
      retire = true;
      const write =
        action === "saveHead"
          ? repo.saveHead(
              "remote",
              {
                organizationId: "org",
                accessEpoch: 1,
                accessStateHash: "hash",
                linkedContainerIds: ["folder"],
              },
              generation,
            )
          : repo[action]([candidate], generation);
      await expect(write).rejects.toThrow("Retired discovery");
      expect(
        await sqlite.execSql(
          "SELECT document_id FROM document_discovery_heads",
        ),
      ).toEqual([]);
      expect(
        await sqlite.execSql(
          "SELECT document_id FROM pending_document_discoveries",
        ),
      ).toEqual(action === "acknowledge" ? [{ document_id: "remote" }] : []);
    } finally {
      sqlite.close();
    }
  });
}
