import type {
  ContainerContentsPersistence,
  ContainerCreateIntentErrorInput,
} from "../../../data/persistence/container-contents/containerContentsPersistenceTypes";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

export async function recordContainerCreateIntentError(
  persistence: ContainerContentsPersistence,
  execSql: ExecSql,
  input: ContainerCreateIntentErrorInput,
): Promise<void> {
  const record = persistence.recordCreateIntentRevisionError;
  if (record) {
    await record(execSql, input);
  }
  // A legacy three-argument recorder cannot atomically compare either the
  // intent revision or the generation. Dropping the diagnostic is safer than
  // letting a delayed failure overwrite a newer queued intent.
}
