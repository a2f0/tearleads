import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { savePrincipalHistoryStage } from "../../../data/persistence/principalHistory/principalHistoryStagePersistence";
import { resumeAfterSupersededStage } from "./supersededStageResume";

/** A real progress-CAS loss: another writer published this stage first. */
async function supersededSave(
  execSql: Parameters<typeof savePrincipalHistoryStage>[0]["execSql"],
) {
  const stage = {
    id: "stage-1",
    organizationId: "org-1",
    currentJson: "{}",
    afterVersion: 1,
    complete: false,
    progress: "published-progress",
  };
  const evidence = {
    indexRootHash: "index-root",
    scopeId: "scope-1",
    organizationId: "org-1",
    entries: [],
    nodes: [],
  };
  const save = (previousProgress: string | null) =>
    savePrincipalHistoryStage({
      execSql,
      stage: { ...stage, progress: `${stage.progress}-${previousProgress}` },
      evidence,
      previousProgress,
      stillCurrent: () => true,
    });
  await save(null);
  return save(null);
}

test("a recovery that loses its stage to a publication resumes once", async () => {
  const f = await createTestExecSql("superseded-stage-resume");
  try {
    let attempts = 0;
    const result = await resumeAfterSupersededStage(
      async () => {
        attempts += 1;
        if (attempts === 1) await supersededSave(f.execSql);
        return "resumed";
      },
      () => true,
    );
    expect(result).toBe("resumed");
    expect(attempts).toBe(2);
  } finally {
    f.close();
  }
});

test("a second superseded stage and every other failure propagate", async () => {
  const f = await createTestExecSql("superseded-stage-bounded");
  try {
    let attempts = 0;
    await expect(
      resumeAfterSupersededStage(
        async () => {
          attempts += 1;
          await supersededSave(f.execSql);
        },
        () => true,
      ),
    ).rejects.toMatchObject({ code: "principal_history_stage_changed" });
    expect(attempts).toBe(2);
    attempts = 0;
    await expect(
      resumeAfterSupersededStage(
        async () => {
          attempts += 1;
          throw new Error("history unavailable");
        },
        () => true,
      ),
    ).rejects.toThrow("history unavailable");
    expect(attempts).toBe(1);
  } finally {
    f.close();
  }
});

test("a lifetime that ended during the lost attempt does not resume", async () => {
  const f = await createTestExecSql("superseded-stage-expired");
  try {
    let current = true;
    let attempts = 0;
    await expect(
      resumeAfterSupersededStage(
        async () => {
          attempts += 1;
          current = false;
          await supersededSave(f.execSql);
        },
        () => current,
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  } finally {
    f.close();
  }
});
