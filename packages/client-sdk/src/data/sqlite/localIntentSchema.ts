import { eq, inArray, type SQL } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

/**
 * Lanes of the durable local outbox. Each lane keeps at most one intent per
 * subject: a container may hold a create and a move at once, while a
 * document's move and link coalesce into one placement intent.
 */
export const LOCAL_INTENT_LANES = {
  containerCreate: "container.create",
  containerMove: "container.move",
  documentPlacement: "document.placement",
} as const;

export type LocalIntentLane =
  (typeof LOCAL_INTENT_LANES)[keyof typeof LOCAL_INTENT_LANES];

/**
 * Device-first structural writes waiting for remote replay: container creates,
 * container moves, and document placement (move and link) intents.
 *
 * Every lane shares one revision protocol: `id` is rewritten on each enqueue or
 * repair, settlement compares `(id, updatedAt)` before acting, and replay runs
 * in `createdAt` order. Remote reset deletes the scoped intents of every lane
 * (and re-queues creates for surviving containers); nothing here survives a
 * reset. Durable requests that must survive reset (the principal mutation
 * journal and organization provisioning attempts) live in their own tables.
 *
 * Columns:
 * - `id`: Revision token and primary key.
 * - `lane`: One of `LOCAL_INTENT_LANES`.
 * - `intentType`: `container.create`, `container.move`, `document.move`, or
 *   `document.link`. A placement intent switches between the last two in place.
 * - `subjectId`: Container id for container lanes, server document id for the
 *   placement lane.
 * - `localId`: Local document row the placement intent updates; null for
 *   container lanes.
 * - `targetContainerId`: Desired parent (container lanes) or target container
 *   (placement lane).
 * - `sourceContainerId`: Parent observed when a container move was first
 *   queued, or the source container a document move unlinks.
 * - `replaceLinkedContainers`: Placement only — the final remote link set is
 *   only the target container.
 * - `remoteContainerId`, `remoteMetadataDocumentId`,
 *   `remoteMetadataAccessStateHash`: Remote identities a container create
 *   records once accepted.
 * - `syncStatus`: Lane-specific state (`pending`/`synced` for creates,
 *   `pending`/`blocked` for container moves, `pending`/`blocked`/`denied`/
 *   `unavailable` for placements).
 * - `lastError`, `lastAttemptedAt`: Replay diagnostics.
 * - `createdAt`: FIFO replay order; `updatedAt`: last target/status change.
 *
 * Indexes:
 * - `(lane, subjectId)` is unique so repeated enqueues coalesce per lane.
 * - `(lane, syncStatus, createdAt)` lists a lane's queue in order.
 */
export const localIntents = sqliteTable(
  "local_intents",
  {
    id: text("id"),
    lane: text("lane").notNull(),
    intentType: text("intent_type").notNull(),
    subjectId: text("subject_id").notNull(),
    localId: text("local_id"),
    targetContainerId: text("target_container_id").notNull(),
    sourceContainerId: text("source_container_id"),
    replaceLinkedContainers: integer("replace_linked_containers", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    remoteContainerId: text("remote_container_id"),
    remoteMetadataDocumentId: text("remote_metadata_document_id"),
    remoteMetadataAccessStateHash: text("remote_metadata_access_state_hash"),
    syncStatus: text("sync_status").notNull(),
    lastError: text("last_error"),
    lastAttemptedAt: text("last_attempted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    unique().on(table.lane, table.subjectId),
    index("local_intents_lane_status_created_idx").on(
      table.lane,
      table.syncStatus,
      table.createdAt,
    ),
  ],
);

/** The conflict target that coalesces repeated enqueues within a lane. */
export const LOCAL_INTENT_SUBJECT = [localIntents.lane, localIntents.subjectId];

export function inLocalIntentLane(lane: LocalIntentLane): SQL {
  return eq(localIntents.lane, lane);
}

/** Both container lanes: what a container's own removal or reset discards. */
export function inContainerIntentLanes(): SQL {
  return inArray(localIntents.lane, [
    LOCAL_INTENT_LANES.containerCreate,
    LOCAL_INTENT_LANES.containerMove,
  ]);
}
