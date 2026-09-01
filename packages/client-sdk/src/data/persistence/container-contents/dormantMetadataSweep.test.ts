import { expect, test } from "bun:test";
import { createTestExecSql } from "@symcrypt/test-utils";
import { ensureContainerTables } from "../containers/containerPersistence";
import {
  claimDormantMetadataSweepAttempt,
  completeDormantMetadataSweepRequest,
  listDormantMetadataSweepCandidates,
  listDormantMetadataSweepRequests,
  purgeDormantContainerMetadataCandidates,
  requestDormantMetadataRestorationSweeps,
} from "./dormantMetadataSweep";

test("restoration requests are skipped without dormant metadata", async () => {
  const { close, execSql } = await createTestExecSql(
    "dormant-metadata-sweep-empty",
  );
  try {
    await expect(
      requestDormantMetadataRestorationSweeps(execSql, {
        requesterUserId: "user-1",
      }),
    ).resolves.toBe(0);
    expect(await listDormantMetadataSweepRequests(execSql, "user-1")).toEqual(
      [],
    );
  } finally {
    await close();
  }
});

test("sweeps preserve newer requests and post-request retentions", async () => {
  const { close, execSql } = await createTestExecSql(
    "dormant-metadata-sweep-generation",
  );
  try {
    const request = { requesterUserId: "user-1" };
    await ensureContainerTables(execSql);
    await execSql(
      `INSERT INTO dormant_container_metadata
        (container_id, organization_id, retained_at)
       VALUES ('old-marker', 'org-1', '2000-01-01T00:00:00.000Z'),
              ('late-marker', 'org-1', '9999-01-01T00:00:00.000Z')`,
    );
    await requestDormantMetadataRestorationSweeps(execSql, request);
    await requestDormantMetadataRestorationSweeps(execSql, {
      ...request,
      requesterUserId: "user-2",
    });
    const firstSweep = (
      await listDormantMetadataSweepRequests(execSql, request.requesterUserId)
    )[0];
    if (!firstSweep) {
      throw new Error("Expected the first restoration sweep");
    }
    expect(firstSweep).toMatchObject({
      attemptCount: 0,
      lastAttemptedAt: null,
    });
    await expect(
      claimDormantMetadataSweepAttempt(
        execSql,
        firstSweep,
        "2025-12-31T00:00:00.000Z",
        () => false,
      ),
    ).resolves.toBe(false);
    expect(
      (
        await listDormantMetadataSweepRequests(execSql, request.requesterUserId)
      ).at(0),
    ).toMatchObject({
      attemptCount: 0,
      lastAttemptedAt: null,
    });
    await expect(
      claimDormantMetadataSweepAttempt(
        execSql,
        firstSweep,
        "2026-01-01T00:00:00.000Z",
      ),
    ).resolves.toBe(true);
    expect(
      (
        await listDormantMetadataSweepRequests(execSql, request.requesterUserId)
      ).at(0),
    ).toMatchObject({
      attemptCount: 1,
      lastAttemptedAt: "2026-01-01T00:00:00.000Z",
    });
    await requestDormantMetadataRestorationSweeps(execSql, request);
    expect(
      await listDormantMetadataSweepCandidates(execSql, firstSweep),
    ).toEqual([]);
    expect(
      await purgeDormantContainerMetadataCandidates(execSql, firstSweep, [
        "old-marker",
      ]),
    ).toBe(0);
    await completeDormantMetadataSweepRequest(execSql, firstSweep);
    const latestSweep = (
      await listDormantMetadataSweepRequests(execSql, request.requesterUserId)
    )[0];
    expect(latestSweep?.generation).toBe(firstSweep.generation + 1);
    expect(latestSweep).toMatchObject({
      attemptCount: 0,
      lastAttemptedAt: null,
    });
    if (!latestSweep) {
      throw new Error("Expected the newer restoration sweep");
    }
    const candidates = await listDormantMetadataSweepCandidates(
      execSql,
      latestSweep,
    );
    expect(candidates).toEqual(["old-marker"]);
    expect(
      await purgeDormantContainerMetadataCandidates(
        execSql,
        latestSweep,
        candidates,
      ),
    ).toBe(1);
    const remainingMarkers = await execSql(
      "SELECT container_id FROM dormant_container_metadata ORDER BY container_id",
    );
    expect(remainingMarkers).toEqual([{ container_id: "late-marker" }]);
    await completeDormantMetadataSweepRequest(execSql, latestSweep);
    expect(
      await listDormantMetadataSweepRequests(execSql, request.requesterUserId),
    ).toEqual([]);
    expect(
      await listDormantMetadataSweepRequests(execSql, "user-2"),
    ).toHaveLength(1);
  } finally {
    await close();
  }
});

test("an expired generation cannot purge metadata or complete its sweep", async () => {
  const { close, execSql } = await createTestExecSql(
    "dormant-metadata-sweep-expired-generation",
  );
  try {
    await ensureContainerTables(execSql);
    await execSql(
      `INSERT INTO dormant_container_metadata
        (container_id, organization_id, retained_at)
       VALUES ('retained-marker', 'org-1', '2000-01-01T00:00:00.000Z')`,
    );
    await requestDormantMetadataRestorationSweeps(execSql, {
      requesterUserId: "user-1",
    });
    const [sweep] = await listDormantMetadataSweepRequests(execSql, "user-1");
    if (!sweep) throw new Error("Expected restoration sweep");

    expect(
      await purgeDormantContainerMetadataCandidates(
        execSql,
        sweep,
        ["retained-marker"],
        () => false,
      ),
    ).toBe(0);
    await completeDormantMetadataSweepRequest(execSql, sweep, () => false);

    expect(
      await execSql(
        "SELECT container_id FROM dormant_container_metadata ORDER BY container_id",
      ),
    ).toEqual([{ container_id: "retained-marker" }]);
    expect(await listDormantMetadataSweepRequests(execSql, "user-1")).toEqual([
      sweep,
    ]);
  } finally {
    await close();
  }
});
