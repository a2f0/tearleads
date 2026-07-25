import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "./containerContentsPersistence";

test("container existence checks initialize their table", async () => {
  const { close, execSql } = await createTestExecSql(
    "container-contents-exists-schema",
  );
  try {
    await expect(
      sqlContainerContentsPersistence.containerExists(execSql, "missing"),
    ).resolves.toBe(false);
  } finally {
    close();
  }
});
