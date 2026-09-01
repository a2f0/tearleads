import { expect, test } from "bun:test";
import type { ContainerCreateIntentErrorInput } from "../../../data/persistence/container-contents/containerContentsPersistenceTypes";
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
    recordCreateIntentErrorInputVersion: undefined,
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

test("create intent errors use the explicit revision-guarded adapter capability", async () => {
  const execSql: ExecSql = async () => [];
  const calls: unknown[] = [];
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    // A rest-parameter function has length zero. The capability marker, not
    // Function.length, must select the object contract.
    recordCreateIntentError: async (
      ...args: [ExecSql, ContainerCreateIntentErrorInput]
    ) => {
      calls.push(args[1]);
    },
  };

  const input = {
    containerId: "current-container",
    expectedIntentId: "current-intent",
    expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
    message: "current failure",
    stillCurrent: () => true,
  };
  await recordContainerCreateIntentError(persistence, execSql, input);

  expect(calls).toEqual([input]);
});
