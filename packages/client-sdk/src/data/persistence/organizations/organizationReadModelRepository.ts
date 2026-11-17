import type { OrganizationReadModelResponse } from "@tearleads/validators/response";
import { and, eq } from "drizzle-orm";
import { getOrCreatePrincipalPolicyCoordinator } from "../../principals/principalPolicyCoordinator";
import { organizationReadModelTables } from "../../sqlite/schema";
import { organizationDataUsageTables } from "../../sqlite/schema/organizationDataUsageSchema";
import {
  organizationPresentationDenials,
  organizationReadModelGroups,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../sqlite/schema/organizationReadModelSchema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../../sqlite/sqlSchema";
import { purgeOrganizationDataUsageProjectionInTransaction } from "./organizationDataUsagePersistence";
import type {
  OrganizationPresentationDenialProjection,
  OrganizationPresentationDenialScope,
} from "./organizationPresentationDenialPersistence";
import { notifyOrganizationReadModelInvalidated } from "./organizationReadModelInvalidation";
import {
  loadRequesterOrganizationReadModelGroupMembersInTransaction,
  type OrganizationReadModelGroupMembers,
} from "./organizationReadModelMemberLoad";
import {
  type ApplyOrganizationReadModelResponseResult,
  applyOrganizationReadModelResponseInTransaction,
} from "./organizationReadModelPersistence";
import {
  loadOrganizationReadModelProjectionInTransaction,
  type OrganizationReadModelProjection,
} from "./organizationReadModelProjection";
import { OrganizationReadModelIntegrityError } from "./organizationReadModelProtocol";
import { purgeOrganizationReadModelProjectionInTransaction } from "./organizationReadModelPurge";
import { assertOrganizationReadModelResponse } from "./organizationReadModelResponseAssertions";

const organizationAccessProjectionTables = [
  ...organizationReadModelTables,
  ...organizationDataUsageTables,
];

/**
 * The durable organization read-model projection, its group display names,
 * and its presentation denial markers, over one database. Invalidation
 * notices and recovery invalidation are keyed by the executor this
 * repository was built from.
 */
export class OrganizationReadModelRepository {
  constructor(
    private readonly execSql: ExecSql,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The ONE load shell for the durable read-model projection: run `load` in a
   * transaction and, if a stored row fails integrity validation, purge the
   * organization's projection and report null. The projection is a
   * server-refetchable cache, so the next reconcile requests a cursorless
   * snapshot instead of every read and repair pass failing on the same row.
   */
  private async loadWithOrganizationReadModelIntegrityPurge<T>(input: {
    readonly load: (tx: ClientSQLiteTransactionScope) => Promise<T | null>;
    readonly organizationId: string;
  }): Promise<T | null> {
    await ensureSqlTables(this.execSql, organizationReadModelTables);
    let purgedInvalidRows = false;
    const result = await getClientSQLitePersistenceRuntime(
      this.execSql,
    ).transaction(async (tx) => {
      try {
        return await input.load(tx);
      } catch (error) {
        if (!(error instanceof OrganizationReadModelIntegrityError)) {
          throw error;
        }
        await purgeOrganizationReadModelProjectionInTransaction({
          organizationId: input.organizationId,
          tx,
        });
        purgedInvalidRows = true;
        return null;
      }
    });
    if (purgedInvalidRows) {
      // Realtime consumers may hold a caught-up lease over rows that no longer
      // exist; the notification lets them drop it and refetch authoritatively.
      notifyOrganizationReadModelInvalidated(
        this.execSql,
        input.organizationId,
      );
    }
    return result;
  }

  async loadOrganizationReadModelProjection(
    organizationId: string,
    currentUserId: string,
  ): Promise<OrganizationReadModelProjection | null> {
    return this.loadWithOrganizationReadModelIntegrityPurge({
      organizationId,
      load: (tx) =>
        loadOrganizationReadModelProjectionInTransaction({
          currentUserId,
          organizationId,
          tx,
        }),
    });
  }

  async loadOrganizationReadModelGroupMembers(
    organizationId: string,
    groupId: string,
    currentUserId: string,
  ): Promise<OrganizationReadModelGroupMembers | null> {
    return this.loadWithOrganizationReadModelIntegrityPurge({
      organizationId,
      load: (tx) =>
        loadRequesterOrganizationReadModelGroupMembersInTransaction(tx, {
          currentUserId,
          groupId,
          organizationId,
        }),
    });
  }

  async applyOrganizationReadModelResponse(input: {
    readonly currentUserId: string;
    readonly requestedCursor: string | null;
    readonly response: OrganizationReadModelResponse;
  }): Promise<ApplyOrganizationReadModelResponseResult> {
    assertOrganizationReadModelResponse({
      currentUserId: input.currentUserId,
      response: input.response,
    });
    // The requester prune also retires pruned users' usage projections.
    await ensureSqlTables(this.execSql, organizationAccessProjectionTables);

    const disposition = await getClientSQLitePersistenceRuntime(
      this.execSql,
    ).transaction(
      (tx): Promise<ApplyOrganizationReadModelResponseResult> =>
        applyOrganizationReadModelResponseInTransaction(tx, {
          currentUserId: input.currentUserId,
          now: this.now,
          requestedCursor: input.requestedCursor,
          response: input.response,
        }),
    );
    // An applied change follows an organization hint or mutation; in-flight
    // operations recover the directory again instead of reusing their memo.
    if (disposition === "applied")
      getOrCreatePrincipalPolicyCoordinator(this.execSql).invalidateRecovery(
        input.response.organizationId,
      );
    return disposition;
  }

  async purgeOrganizationReadModelProjection(
    organizationId: string,
    options: { readonly onlyRequesterUserId?: string } = {},
  ): Promise<void> {
    await ensureSqlTables(this.execSql, organizationReadModelTables);
    await getClientSQLitePersistenceRuntime(this.execSql).transaction(
      async (tx) => {
        await purgeOrganizationReadModelProjectionInTransaction({
          onlyRequesterUserId: options.onlyRequesterUserId,
          organizationId,
          tx,
        });
      },
    );
  }

  /**
   * Purge one requester's access to an organization's presentation projections
   * after the server denied that requester. The denial is requester-scoped: the
   * shared read-model rows stay while another local identity in the same
   * database still holds a requester row, and organization-wide rows fall with
   * the last requester.
   */
  async purgeOrganizationAccessProjection(input: {
    readonly organizationId: string;
    readonly requesterUserId: string;
  }): Promise<void> {
    await ensureSqlTables(this.execSql, organizationAccessProjectionTables);
    await getClientSQLitePersistenceRuntime(this.execSql).transaction(
      async (tx) => {
        await tx
          .delete(organizationReadModelRequesters)
          .where(
            and(
              eq(
                organizationReadModelRequesters.organizationId,
                input.organizationId,
              ),
              eq(organizationReadModelRequesters.userId, input.requesterUserId),
            ),
          )
          .run();
        const [remainingRequester] = await tx
          .select({ userId: organizationReadModelRequesters.userId })
          .from(organizationReadModelRequesters)
          .where(
            eq(
              organizationReadModelRequesters.organizationId,
              input.organizationId,
            ),
          )
          .limit(1);
        if (!remainingRequester) {
          await purgeOrganizationReadModelProjectionInTransaction({
            organizationId: input.organizationId,
            tx,
          });
        }
        await purgeOrganizationDataUsageProjectionInTransaction({
          organizationId: input.organizationId,
          requesterUserId: input.requesterUserId,
          tx,
        });
      },
    );
    // A denial is a realtime-hinted access change: in-flight operations recover
    // the organization's directory again instead of reusing their memo.
    getOrCreatePrincipalPolicyCoordinator(this.execSql).invalidateRecovery(
      input.organizationId,
    );
  }

  /**
   * The cursor this requester has applied, or null when it holds none. The
   * organization row's cursor is shared: another identity on this device may
   * have advanced it while this requester's own fields (for example
   * `isOrgAdmin`) still reflect an older response. Only the requester's own
   * applied cursor, while it is still the stored projection's cursor, proves
   * this requester is current. Realtime hints compare against it so a hint for
   * a cursor already applied costs no read.
   */
  async loadAppliedOrganizationReadModelCursor(input: {
    readonly organizationId: string;
    readonly requesterUserId: string;
  }): Promise<string | null> {
    await ensureSqlTables(this.execSql, organizationReadModelTables);
    const [row] = await getClientSQLitePersistenceRuntime(this.execSql)
      .db.select({ cursor: organizationReadModelRequesters.appliedCursor })
      .from(organizationReadModelRequesters)
      .innerJoin(
        organizationReadModelState,
        and(
          eq(
            organizationReadModelState.organizationId,
            organizationReadModelRequesters.organizationId,
          ),
          eq(
            organizationReadModelState.cursor,
            organizationReadModelRequesters.appliedCursor,
          ),
        ),
      )
      .where(
        and(
          eq(
            organizationReadModelRequesters.organizationId,
            input.organizationId,
          ),
          eq(organizationReadModelRequesters.userId, input.requesterUserId),
        ),
      )
      .limit(1);
    return row?.cursor ?? null;
  }

  /**
   * Every locally projected organization's pointer to its organization_profile
   * document, keyed by organization id.
   *
   * This is the only container-independent handle on that document. Callers
   * that need an org's display name from local state cannot rely on where the
   * document is linked: the provisioner writes it under a deterministic local
   * alias into the organization-metadata container, while a device that only
   * *synced* it (identity recovery, another member) keys it under the server
   * documentId in whichever container the grant arrived through.
   *
   * The local schema stores only the current read-model contract, so every
   * state row is eligible to provide its profile-document pointer.
   */
  async loadOrganizationProfileDocumentIds(): Promise<Map<string, string>> {
    await ensureSqlTables(this.execSql, organizationReadModelTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const rows = await db
      .select({
        organizationId: organizationReadModelState.organizationId,
        profileDocumentId: organizationReadModelState.profileDocumentId,
      })
      .from(organizationReadModelState);

    return new Map(
      rows.flatMap((row) =>
        row.profileDocumentId
          ? [[row.organizationId, row.profileDocumentId]]
          : [],
      ),
    );
  }

  async loadOrganizationGroupDisplayNames(
    organizationId: string,
  ): Promise<ReadonlyMap<string, string>> {
    await ensureSqlTables(this.execSql, organizationReadModelTables);
    const { db } = getClientSQLitePersistenceRuntime(this.execSql);
    const rows = await db
      .select({
        groupId: organizationReadModelGroups.groupId,
        name: organizationReadModelGroups.name,
      })
      .from(organizationReadModelGroups)
      .where(eq(organizationReadModelGroups.organizationId, organizationId));
    return new Map(
      rows
        .filter((row) => row.name.length > 0)
        .map((row) => [row.groupId, row.name]),
    );
  }

  /** Local display cache only: these labels never enter a server request. */
  async saveOrganizationGroupDisplayNames(input: {
    organizationId: string;
    names: readonly { groupId: string; name: string; stateHash: string }[];
    stillCurrent: () => boolean;
  }): Promise<void> {
    await ensureSqlTables(this.execSql, organizationReadModelTables);
    await getClientSQLitePersistenceRuntime(this.execSql).guardedTransaction(
      async (tx) => {
        for (const group of input.names) {
          await tx
            .update(organizationReadModelGroups)
            .set({ name: group.name })
            .where(
              and(
                eq(
                  organizationReadModelGroups.organizationId,
                  input.organizationId,
                ),
                eq(organizationReadModelGroups.groupId, group.groupId),
                eq(organizationReadModelGroups.stateHash, group.stateHash),
              ),
            )
            .run();
        }
      },
      input.stillCurrent,
    );
  }

  /**
   * Durably record a server denial before the revoked projection rows are
   * purged. The marker is what keeps a failed purge plus an offline restart
   * from serving the revoked projection; it is cleared only when an
   * authoritative reconcile stores fresh server state for the same scope.
   */
  async recordOrganizationPresentationDenials(
    scope: OrganizationPresentationDenialScope,
    projections: readonly OrganizationPresentationDenialProjection[],
  ): Promise<void> {
    await ensureSqlTables(this.execSql, organizationReadModelTables);
    const deniedAt = this.now().toISOString();
    await getClientSQLitePersistenceRuntime(this.execSql).transaction(
      async (tx) => {
        for (const projection of new Set(projections)) {
          await tx
            .insert(organizationPresentationDenials)
            .values({
              organizationId: scope.organizationId,
              requesterUserId: scope.requesterUserId,
              projection,
              deniedAt,
            })
            .onConflictDoUpdate({
              target: [
                organizationPresentationDenials.organizationId,
                organizationPresentationDenials.requesterUserId,
                organizationPresentationDenials.projection,
              ],
              set: { deniedAt },
            })
            .run();
        }
      },
    );
  }

  async hasOrganizationPresentationDenial(
    scope: OrganizationPresentationDenialScope,
    projection: OrganizationPresentationDenialProjection,
  ): Promise<boolean> {
    await ensureSqlTables(this.execSql, organizationReadModelTables);
    const rows = await getClientSQLitePersistenceRuntime(this.execSql)
      .db.select({ projection: organizationPresentationDenials.projection })
      .from(organizationPresentationDenials)
      .where(
        and(
          eq(
            organizationPresentationDenials.organizationId,
            scope.organizationId,
          ),
          eq(
            organizationPresentationDenials.requesterUserId,
            scope.requesterUserId,
          ),
          eq(organizationPresentationDenials.projection, projection),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
