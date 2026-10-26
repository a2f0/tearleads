import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { createCodebaseArchive } from "./archive";
import { apiRequest, root, settings, stateDir } from "./settings";
import { configSchema } from "./types";

const entity = z.object({
  _id: z.string(),
  name: z.string().optional(),
  sourceType: z.string().optional(),
  latestRevisionId: z.string().optional(),
});

/** Upload committed source and fresh Git metadata, excluding host/local state. */
export async function register(ref: string, baseRef: string): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  const archive = join(stateDir, "tearleads2.tar.gz");
  const { commit, baseCommit } = await createCodebaseArchive(
    root,
    archive,
    ref,
    baseRef,
  );
  const projects = z.array(entity).parse(await apiRequest("/projects"));
  const matches = projects.filter((project) => project.name === "Tearleads");
  if (matches.length > 1) throw new Error("Multiple Tearleads projects found");
  const project =
    matches[0] ??
    entity.parse(
      await apiRequest("/projects", {
        name: "Tearleads",
        description:
          "Local repository discoverability probes: Claude Code with a calibrated Codex Judge.",
      }),
    );
  const query = `?projectId=${encodeURIComponent(project._id)}`;
  const codebases = z
    .array(entity)
    .parse(await apiRequest(`/codebases${query}`));
  const existing = codebases.filter(
    (codebase) => codebase.name === "tearleads2",
  );
  if (existing.length > 1)
    throw new Error("Multiple tearleads2 codebases found");
  const codebase = existing[0];
  if (codebase && codebase.sourceType !== "archive")
    throw new Error("Expected archive codebase");
  const form = new FormData();
  form.set("archive", Bun.file(archive), "tearleads2.tar.gz");
  let codebaseId: string;
  let revisionId: string | undefined;
  if (codebase) {
    const revision = entity.parse(
      await apiRequest(
        `/codebases/${encodeURIComponent(codebase._id)}/upload`,
        form,
      ),
    );
    codebaseId = codebase._id;
    revisionId = revision._id;
  } else {
    form.set("name", "tearleads2");
    form.set("sourceType", "archive");
    form.set(
      "description",
      "Committed source snapshots from the local checkout.",
    );
    const created = entity.parse(await apiRequest(`/codebases${query}`, form));
    codebaseId = created._id;
    revisionId = created.latestRevisionId;
  }
  const config = configSchema.parse({
    apiUrl: settings.apiUrl,
    projectId: project._id,
    codebaseId,
    revisionId,
    commit,
    baseCommit,
  });
  await writeFile(
    join(stateDir, "config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(
    `Registered ${commit} (base ${baseCommit}) at ${settings.apiUrl}; revision ${config.revisionId}`,
  );
}
