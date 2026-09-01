import { expect, test } from "bun:test";
import type { ContainerCreateIntentErrorInput } from "../../../data/persistence/container-contents/containerContentsPersistenceTypes";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import {
  type ContainerContentsPersistence,
  defaultContainerContentsPersistence,
} from "../containerPersistence";
import { recordContainerCreateIntentError } from "./createIntentErrorAdapter";

test("guarded create intent errors skip legacy recorders without revision CAS", async () => {
  const execSql: ExecSql = async () => [];
  const calls: Array<{ containerId: string; message: string }> = [];
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    recordCreateIntentRevisionError: undefined,
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
    expectedIntentId: "current-intent",
    expectedUpdatedAt: "2026-09-01T00:00:00.000Z",
    message: "legacy failure",
    stillCurrent: () => true,
  });

  expect(calls).toEqual([]);
});

test("create intent errors use the structural revision-guarded adapter capability", async () => {
  const execSql: ExecSql = async () => [];
  const calls: unknown[] = [];
  const persistence: ContainerContentsPersistence = {
    ...defaultContainerContentsPersistence,
    // A rest-parameter function has length zero. The named capability, not
    // Function.length or function identity, selects the guarded contract.
    recordCreateIntentRevisionError: async (
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
