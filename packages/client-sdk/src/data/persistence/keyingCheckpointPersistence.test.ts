import { expect, test } from "bun:test";
import type {
  AccessManifestCheckpoint,
  PrincipalPolicyCheckpoint,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  loadAccessManifestCheckpoint,
  loadPrincipalPolicyCheckpoint,
  saveAccessManifestCheckpoint,
  savePrincipalPolicyCheckpoint,
} from "./keyingCheckpointPersistence";

const updatedAt = "2026-04-08T00:00:00.000Z";

test("access manifest checkpoint persistence stores and reloads a pin", async () => {
  const { close, execSql } = await createTestExecSql(
    "keying-checkpoint-persistence-test",
  );

  try {
    const checkpoint: AccessManifestCheckpoint = {
      objectKind: "container",
      objectId: "container-1",
      organizationId: "org-1",
      epoch: 3,
      manifestHash: "manifest-hash-3",
    };

    await saveAccessManifestCheckpoint(execSql, checkpoint, updatedAt);

    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        "org-1",
        "container-1",
      ),
    ).resolves.toEqual(checkpoint);
  } finally {
    close();
  }
});

test("access manifest checkpoint persistence advances a pin in place", async () => {
  const { close, execSql } = await createTestExecSql(
    "keying-checkpoint-persistence-test",
  );

  try {
    await saveAccessManifestCheckpoint(
      execSql,
      {
        objectKind: "container",
        objectId: "container-1",
        organizationId: "org-1",
        epoch: 3,
        manifestHash: "manifest-hash-3",
      },
      updatedAt,
    );
    const advanced: AccessManifestCheckpoint = {
      objectKind: "container",
      objectId: "container-1",
      organizationId: "org-1",
      epoch: 4,
      manifestHash: "manifest-hash-4",
    };
    await saveAccessManifestCheckpoint(execSql, advanced, updatedAt);

    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        "org-1",
        "container-1",
      ),
    ).resolves.toEqual(advanced);
  } finally {
    close();
  }
});

test("access manifest checkpoint persistence reads null before any pin", async () => {
  const { close, execSql } = await createTestExecSql(
    "keying-checkpoint-persistence-test",
  );

  try {
    await expect(
      loadAccessManifestCheckpoint(execSql, "container", "org-1", "missing"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("principal policy checkpoint persistence stores and reloads a pin", async () => {
  const { close, execSql } = await createTestExecSql(
    "keying-checkpoint-persistence-test",
  );

  try {
    const checkpoint: PrincipalPolicyCheckpoint = {
      principalType: "group",
      principalId: "group-1",
      version: 2,
      stateHash: "state-hash-2",
    };

    await savePrincipalPolicyCheckpoint(execSql, checkpoint, updatedAt);

    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "group", "group-1"),
    ).resolves.toEqual(checkpoint);
    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "organization", "group-1"),
    ).resolves.toBeNull();
  } finally {
    close();
  }
});

test("access manifest checkpoint persistence never regresses to an older epoch", async () => {
  const { close, execSql } = await createTestExecSql(
    "keying-checkpoint-persistence-test",
  );

  try {
    const head: AccessManifestCheckpoint = {
      objectKind: "container",
      objectId: "container-1",
      organizationId: "org-1",
      epoch: 4,
      manifestHash: "manifest-hash-4",
    };
    await saveAccessManifestCheckpoint(execSql, head, updatedAt);

    // A slower / out-of-order verification tries to write an older epoch.
    await saveAccessManifestCheckpoint(
      execSql,
      {
        objectKind: "container",
        objectId: "container-1",
        organizationId: "org-1",
        epoch: 3,
        manifestHash: "manifest-hash-3",
      },
      updatedAt,
    );

    await expect(
      loadAccessManifestCheckpoint(
        execSql,
        "container",
        "org-1",
        "container-1",
      ),
    ).resolves.toEqual(head);
  } finally {
    close();
  }
});

test("principal policy checkpoint persistence never regresses to an older version", async () => {
  const { close, execSql } = await createTestExecSql(
    "keying-checkpoint-persistence-test",
  );

  try {
    const head: PrincipalPolicyCheckpoint = {
      principalType: "group",
      principalId: "group-1",
      version: 5,
      stateHash: "state-hash-5",
    };
    await savePrincipalPolicyCheckpoint(execSql, head, updatedAt);

    await savePrincipalPolicyCheckpoint(
      execSql,
      {
        principalType: "group",
        principalId: "group-1",
        version: 3,
        stateHash: "state-hash-3",
      },
      updatedAt,
    );

    await expect(
      loadPrincipalPolicyCheckpoint(execSql, "group", "group-1"),
    ).resolves.toEqual(head);
  } finally {
    close();
  }
});
