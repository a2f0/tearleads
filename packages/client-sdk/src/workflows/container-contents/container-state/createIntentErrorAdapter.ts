import {
  type ContainerContentsPersistence,
  type ContainerCreateIntentErrorInput,
  usesRevisionGuardedCreateIntentErrorInput,
} from "../../../data/persistence/container-contents/containerContentsPersistenceTypes";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

/** Preserve adapters implementing the pre-generation-fence three-arg seam. */
export function recordContainerCreateIntentError(
  persistence: ContainerContentsPersistence,
  execSql: ExecSql,
  input: ContainerCreateIntentErrorInput,
): Promise<void> {
  const record = persistence.recordCreateIntentError;
  if (usesRevisionGuardedCreateIntentErrorInput(record)) {
    return record(execSql, input);
  }
  return record(execSql, input.containerId, input.message);
}
