import {
  CONTAINER_CREATE_INTENT_ERROR_INPUT_VERSION,
  type ContainerContentsPersistence,
  type ContainerCreateIntentErrorInput,
} from "../../../data/persistence/container-contents/containerContentsPersistenceTypes";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";

type CurrentRecorder = (
  execSql: ExecSql,
  input: ContainerCreateIntentErrorInput,
) => Promise<void>;
type LegacyRecorder = (
  execSql: ExecSql,
  containerId: string,
  message: string,
) => Promise<void>;

/** Preserve adapters implementing the pre-generation-fence three-arg seam. */
export function recordContainerCreateIntentError(
  persistence: ContainerContentsPersistence,
  execSql: ExecSql,
  input: ContainerCreateIntentErrorInput,
): Promise<void> {
  const record = persistence.recordCreateIntentError;
  return persistence.recordCreateIntentErrorInputVersion ===
    CONTAINER_CREATE_INTENT_ERROR_INPUT_VERSION
    ? (record as CurrentRecorder)(execSql, input)
    : (record as LegacyRecorder)(execSql, input.containerId, input.message);
}
