import { expect, test } from "bun:test";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import { recordContainerCreateIntentError } from "./createIntentErrorAdapter";

test("create intent errors preserve the legacy three-argument adapter seam", async () => {
  const execSql: ExecSql = async () => [];
  const calls: Array<{ containerId: string; message: string }> = [];
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    recordCreateIntentError: async (
      _execSql: ExecSql,
      containerId: string,
      message: string,
    ) => {
      calls.push({ containerId, message });
    },
  };

  await recordContainerCreateIntentError(persistence, execSql, {
    containerId: "legacy-container",
    expectedIntentId: "ignored-by-legacy-adapter",
    expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
    message: "legacy failure",
    stillCurrent: () => true,
  });

  expect(calls).toEqual([
    { containerId: "legacy-container", message: "legacy failure" },
  ]);
});
