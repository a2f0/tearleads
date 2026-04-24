import type { ManagedRecipientPrincipalType } from "@tearleads/crypto";
import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";
import { inArray } from "drizzle-orm";
import type { DatabaseExecutor } from "../adapters/postgres";
import { users } from "../schema";
import { uniqueSortedStrings } from "../utils/array";
import { toReferencedPrincipalState } from "./principalReferences";
import {
  getCurrentPrincipalStates,
  listCurrentPrincipalProjectionMembers,
  type StoredPrincipalState,
} from "./principalStateStore";
import {
  type EffectivePrincipalRecipient,
  isAccessLevel,
  mergeAccessLevel,
  principalRecipientKey,
  toEffectivePrincipalRecipient,
  toEffectiveUserPrincipalRecipient,
} from "./recipientPrincipals";

export type AccessGrantRow = {
  objectId: string;
  subjectType: string;
  subjectId: string;
  accessLevel: string;
};

export interface GrantedRecipientWithObjectIdRow {
  objectId: string;
  userId: string;
  accessLevel: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
}

interface ResolvedGrantEffects {
  grantedRecipients: GrantedRecipientWithObjectIdRow[];
  referencedPrincipalsByObjectId: Map<
    string,
    ReferencedPrincipalStateResponse[]
  >;
}

interface DirectUserGrantRecipientRow {
  userId: string;
  encapsulationPublicKey: string;
  encapsulationKeyFingerprint: string;
}

type ProjectionMember = Awaited<
  ReturnType<typeof listCurrentPrincipalProjectionMembers>
>[number];

interface ManagedPrincipalExpansion {
  referencedPrincipals: ReferencedPrincipalStateResponse[];
  userRecipients: DirectUserGrantRecipientRow[];
}

type ManagedPrincipalTypeMap<T> = Map<ManagedRecipientPrincipalType, T>;

export class ContainerCryptoRecipientResolutionError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "ContainerCryptoRecipientResolutionError";
  }
}

function isManagedPrincipalType(
  value: string,
): value is ManagedRecipientPrincipalType {
  return value === "group" || value === "organization";
}

function missingDirectUserRecipientMessage(userId: string): string {
  return `Missing direct user recipient key for user:${userId}`;
}

function missingManagedPrincipalStateMessage(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): string {
  return `Missing current principal policy state for ${principalType}:${principalId}`;
}

function membershipCycleMessage(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): string {
  return `Principal membership cycle detected for ${principalType}:${principalId}`;
}

function managedPrincipalKey(
  principalType: ManagedRecipientPrincipalType,
  principalId: string,
): string {
  return `${principalType}:${principalId}`;
}

function referencedPrincipalKey(
  principal: Pick<
    ReferencedPrincipalStateResponse,
    "principalType" | "principalId"
  >,
): string {
  return `${principal.principalType}:${principal.principalId}`;
}

function sortReferencedPrincipalStates(
  principals: ReferencedPrincipalStateResponse[],
): ReferencedPrincipalStateResponse[] {
  return principals.sort((left, right) => {
    if (left.principalType !== right.principalType) {
      return left.principalType.localeCompare(right.principalType);
    }

    return left.principalId.localeCompare(right.principalId);
  });
}

function createManagedPrincipalTypeMap<T>(
  createValue: () => T,
): ManagedPrincipalTypeMap<T> {
  return new Map([
    ["group", createValue()],
    ["organization", createValue()],
  ]);
}

async function loadDirectUserGrantRecipients(
  userIds: ReadonlyArray<string>,
  executor: DatabaseExecutor,
): Promise<Map<string, DirectUserGrantRecipientRow>> {
  const uniqueUserIds = uniqueSortedStrings([...userIds]);

  if (uniqueUserIds.length === 0) {
    return new Map();
  }

  const rows = await executor
    .select({
      userId: users.id,
      encapsulationPublicKey: users.encapsulationPublicKey,
      encapsulationKeyFingerprint: users.encapsulationKeyFingerprint,
    })
    .from(users)
    .where(inArray(users.id, uniqueUserIds));

  return new Map(
    rows.map((row) => [
      row.userId,
      {
        userId: row.userId,
        encapsulationPublicKey: row.encapsulationPublicKey,
        encapsulationKeyFingerprint: row.encapsulationKeyFingerprint,
      },
    ]),
  );
}

function upsertCryptoRecipient(
  recipientsByPrincipalKey: Map<string, EffectivePrincipalRecipient>,
  nextRecipient: EffectivePrincipalRecipient,
): void {
  const principalKey = principalRecipientKey(nextRecipient);
  const existingRecipient = recipientsByPrincipalKey.get(principalKey);

  recipientsByPrincipalKey.set(principalKey, {
    ...nextRecipient,
    accessLevel: mergeAccessLevel(
      existingRecipient?.accessLevel,
      nextRecipient.accessLevel,
    ),
  });
}

export class PrincipalGrantResolver {
  private readonly currentPrincipalStatePromisesByType =
    createManagedPrincipalTypeMap<Map<string, Promise<StoredPrincipalState>>>(
      () => new Map(),
    );

  private readonly currentPrincipalStatesByType = createManagedPrincipalTypeMap<
    Map<string, StoredPrincipalState>
  >(() => new Map());

  private readonly directUserGrantRecipientsById = new Map<
    string,
    DirectUserGrantRecipientRow
  >();

  private readonly directUserGrantRecipientPromisesById = new Map<
    string,
    Promise<void>
  >();

  private readonly managedPrincipalExpansionPromisesByKey = new Map<
    string,
    Promise<ManagedPrincipalExpansion>
  >();

  private readonly managedPrincipalExpansionsByKey = new Map<
    string,
    ManagedPrincipalExpansion
  >();

  private readonly projectionMemberPromisesByPrincipalKey = new Map<
    string,
    Promise<ProjectionMember[]>
  >();

  private readonly projectionMembersByPrincipalKey = new Map<
    string,
    ProjectionMember[]
  >();

  constructor(private readonly executor: DatabaseExecutor) {}

  async prime(grants: ReadonlyArray<AccessGrantRow>): Promise<void> {
    await this.ensureDirectUserGrantRecipients(
      grants
        .filter((grant) => grant.subjectType === "user")
        .map((grant) => grant.subjectId),
    );

    await Promise.all(
      (["group", "organization"] as const).map((principalType) =>
        this.preloadCurrentPrincipalStates(
          principalType,
          grants
            .filter((grant) => grant.subjectType === principalType)
            .map((grant) => grant.subjectId),
        ),
      ),
    );
  }

  async resolveGrantEffects(
    grants: ReadonlyArray<AccessGrantRow>,
  ): Promise<ResolvedGrantEffects> {
    await this.prime(grants);

    const grantedRecipients: GrantedRecipientWithObjectIdRow[] = [];
    const referencedPrincipalsByObjectId = new Map<
      string,
      Map<string, ReferencedPrincipalStateResponse>
    >();
    const resolvedGrants = await Promise.all(
      grants.map((grant) => this.resolveGrantEffect(grant)),
    );

    for (const resolvedGrant of resolvedGrants) {
      if (!resolvedGrant) {
        continue;
      }

      grantedRecipients.push(...resolvedGrant.grantedRecipients);

      const referencesForObject =
        referencedPrincipalsByObjectId.get(resolvedGrant.grant.objectId) ??
        new Map();
      for (const referencedPrincipal of resolvedGrant.referencedPrincipals) {
        referencesForObject.set(
          referencedPrincipalKey(referencedPrincipal),
          referencedPrincipal,
        );
      }
      referencedPrincipalsByObjectId.set(
        resolvedGrant.grant.objectId,
        referencesForObject,
      );
    }

    return {
      grantedRecipients,
      referencedPrincipalsByObjectId: new Map(
        Array.from(referencedPrincipalsByObjectId.entries()).map(
          ([objectId, referencedPrincipals]) => [
            objectId,
            sortReferencedPrincipalStates(
              Array.from(referencedPrincipals.values()),
            ),
          ],
        ),
      ),
    };
  }

  async buildCryptoRecipients(
    grants: ReadonlyArray<AccessGrantRow>,
  ): Promise<EffectivePrincipalRecipient[]> {
    await this.prime(grants);

    const recipientsByPrincipalKey = new Map<
      string,
      EffectivePrincipalRecipient
    >();

    for (const grant of grants) {
      if (!isAccessLevel(grant.accessLevel)) {
        continue;
      }

      if (grant.subjectType === "user") {
        const userRecipient = this.directUserGrantRecipientsById.get(
          grant.subjectId,
        );

        if (!userRecipient) {
          throw new ContainerCryptoRecipientResolutionError(
            missingDirectUserRecipientMessage(grant.subjectId),
          );
        }

        upsertCryptoRecipient(
          recipientsByPrincipalKey,
          toEffectiveUserPrincipalRecipient({
            userId: grant.subjectId,
            accessLevel: grant.accessLevel,
            encapsulationPublicKey: userRecipient.encapsulationPublicKey,
            keyFingerprint: userRecipient.encapsulationKeyFingerprint,
          }),
        );
        continue;
      }

      if (!isManagedPrincipalType(grant.subjectType)) {
        throw new ContainerCryptoRecipientResolutionError(
          `Unsupported container grant subject type ${grant.subjectType}`,
        );
      }

      const currentPrincipalState = await this.getCurrentManagedPrincipalState(
        grant.subjectType,
        grant.subjectId,
      );
      upsertCryptoRecipient(
        recipientsByPrincipalKey,
        toEffectivePrincipalRecipient({
          principalType: currentPrincipalState.principalType,
          principalId: currentPrincipalState.principalId,
          accessLevel: grant.accessLevel,
          encapsulationPublicKey: currentPrincipalState.encapsulationPublicKey,
          keyFingerprint: currentPrincipalState.keyFingerprint,
        }),
      );
    }

    return Array.from(recipientsByPrincipalKey.values()).sort((left, right) =>
      left.keyFingerprint.localeCompare(right.keyFingerprint),
    );
  }

  private async preloadCurrentPrincipalStates(
    principalType: ManagedRecipientPrincipalType,
    principalIds: ReadonlyArray<string>,
  ): Promise<void> {
    const statesById = this.currentPrincipalStatesByType.get(principalType);

    if (!statesById) {
      return;
    }

    const missingPrincipalIds = uniqueSortedStrings(
      principalIds.filter((principalId) => !statesById.has(principalId)),
    );

    if (missingPrincipalIds.length === 0) {
      return;
    }

    const currentStates = await getCurrentPrincipalStates(
      principalType,
      missingPrincipalIds,
      this.executor,
    );

    for (const [principalId, state] of currentStates) {
      statesById.set(principalId, state);
    }
  }

  private async ensureDirectUserGrantRecipients(
    userIds: ReadonlyArray<string>,
  ): Promise<void> {
    const uniqueUserIds = uniqueSortedStrings([...userIds]);
    const missingUserIds = uniqueSortedStrings(
      uniqueUserIds.filter(
        (userId) =>
          !this.directUserGrantRecipientsById.has(userId) &&
          !this.directUserGrantRecipientPromisesById.has(userId),
      ),
    );

    if (missingUserIds.length > 0) {
      const loadPromise = (async () => {
        const loadedRecipients = await loadDirectUserGrantRecipients(
          missingUserIds,
          this.executor,
        );

        for (const [userId, recipient] of loadedRecipients) {
          this.directUserGrantRecipientsById.set(userId, recipient);
        }
      })();

      for (const userId of missingUserIds) {
        this.directUserGrantRecipientPromisesById.set(userId, loadPromise);
      }

      void loadPromise.finally(() => {
        for (const userId of missingUserIds) {
          this.directUserGrantRecipientPromisesById.delete(userId);
        }
      });
    }

    const pendingLoads = Array.from(
      new Set(
        uniqueUserIds
          .filter((userId) => !this.directUserGrantRecipientsById.has(userId))
          .map((userId) =>
            this.directUserGrantRecipientPromisesById.get(userId),
          )
          .filter((promise): promise is Promise<void> => promise !== undefined),
      ),
    );

    if (pendingLoads.length > 0) {
      await Promise.all(pendingLoads);
    }
  }

  private async getCurrentManagedPrincipalState(
    principalType: ManagedRecipientPrincipalType,
    principalId: string,
  ): Promise<StoredPrincipalState> {
    const cachedState = this.currentPrincipalStatesByType
      .get(principalType)
      ?.get(principalId);

    if (cachedState) {
      return cachedState;
    }

    const promiseById =
      this.currentPrincipalStatePromisesByType.get(principalType);

    if (!promiseById) {
      throw new Error(`Missing principal state cache for ${principalType}`);
    }

    const cachedPromise = promiseById.get(principalId);
    if (cachedPromise) {
      return cachedPromise;
    }

    const loadPromise = (async () => {
      const loadedStates = await getCurrentPrincipalStates(
        principalType,
        [principalId],
        this.executor,
      );
      const loadedState = loadedStates.get(principalId);

      if (!loadedState) {
        throw new ContainerCryptoRecipientResolutionError(
          missingManagedPrincipalStateMessage(principalType, principalId),
        );
      }

      this.currentPrincipalStatesByType
        .get(principalType)
        ?.set(principalId, loadedState);

      return loadedState;
    })();

    promiseById.set(principalId, loadPromise);

    try {
      return await loadPromise;
    } finally {
      promiseById.delete(principalId);
    }
  }

  private async listProjectionMembers(
    principalType: ManagedRecipientPrincipalType,
    principalId: string,
  ): Promise<ProjectionMember[]> {
    const principalKey = managedPrincipalKey(principalType, principalId);
    const cachedMembers =
      this.projectionMembersByPrincipalKey.get(principalKey);

    if (cachedMembers) {
      return cachedMembers;
    }

    const cachedPromise =
      this.projectionMemberPromisesByPrincipalKey.get(principalKey);

    if (cachedPromise) {
      return cachedPromise;
    }

    const loadPromise = (async () => {
      const loadedMembers = await listCurrentPrincipalProjectionMembers(
        principalType,
        principalId,
        this.executor,
      );

      this.projectionMembersByPrincipalKey.set(principalKey, loadedMembers);

      return loadedMembers;
    })();

    this.projectionMemberPromisesByPrincipalKey.set(principalKey, loadPromise);

    try {
      return await loadPromise;
    } finally {
      this.projectionMemberPromisesByPrincipalKey.delete(principalKey);
    }
  }

  private async buildManagedPrincipalExpansion(
    principalType: ManagedRecipientPrincipalType,
    principalId: string,
    principalKey: string,
    trail: ReadonlySet<string>,
  ): Promise<ManagedPrincipalExpansion> {
    const currentState = await this.getCurrentManagedPrincipalState(
      principalType,
      principalId,
    );
    const projectionMembers = await this.listProjectionMembers(
      principalType,
      principalId,
    );
    const nestedTrail = new Set(trail);
    nestedTrail.add(principalKey);
    const nestedReferencedPrincipals = new Map<
      string,
      ReferencedPrincipalStateResponse
    >([[principalKey, toReferencedPrincipalState(currentState)]]);
    const memberUserIds = new Set<string>();
    const nestedExpansions = await Promise.all(
      projectionMembers.map(async (member) => {
        if (member.memberPrincipalType === "user") {
          memberUserIds.add(member.memberPrincipalId);
          return null;
        }

        return this.expandManagedPrincipal(
          member.memberPrincipalType,
          member.memberPrincipalId,
          nestedTrail,
        );
      }),
    );

    for (const nestedExpansion of nestedExpansions) {
      if (!nestedExpansion) {
        continue;
      }

      for (const recipient of nestedExpansion.userRecipients) {
        memberUserIds.add(recipient.userId);
      }

      for (const referencedPrincipal of nestedExpansion.referencedPrincipals) {
        nestedReferencedPrincipals.set(
          referencedPrincipalKey(referencedPrincipal),
          referencedPrincipal,
        );
      }
    }

    await this.ensureDirectUserGrantRecipients(Array.from(memberUserIds));

    return {
      referencedPrincipals: sortReferencedPrincipalStates(
        Array.from(nestedReferencedPrincipals.values()),
      ),
      userRecipients: uniqueSortedStrings(Array.from(memberUserIds)).map(
        (userId) => {
          const recipient = this.directUserGrantRecipientsById.get(userId);

          if (!recipient) {
            throw new ContainerCryptoRecipientResolutionError(
              missingDirectUserRecipientMessage(userId),
            );
          }

          return recipient;
        },
      ),
    };
  }

  private async expandManagedPrincipal(
    principalType: ManagedRecipientPrincipalType,
    principalId: string,
    trail: ReadonlySet<string> = new Set(),
  ): Promise<ManagedPrincipalExpansion> {
    const principalKey = managedPrincipalKey(principalType, principalId);

    if (trail.has(principalKey)) {
      throw new ContainerCryptoRecipientResolutionError(
        membershipCycleMessage(principalType, principalId),
      );
    }

    const cachedExpansion =
      this.managedPrincipalExpansionsByKey.get(principalKey);
    if (cachedExpansion) {
      return cachedExpansion;
    }

    const cachedPromise =
      this.managedPrincipalExpansionPromisesByKey.get(principalKey);
    if (cachedPromise) {
      return cachedPromise;
    }

    const expansionPromise = this.buildManagedPrincipalExpansion(
      principalType,
      principalId,
      principalKey,
      trail,
    );

    this.managedPrincipalExpansionPromisesByKey.set(
      principalKey,
      expansionPromise,
    );

    try {
      const expansion = await expansionPromise;
      this.managedPrincipalExpansionsByKey.set(principalKey, expansion);
      return expansion;
    } finally {
      this.managedPrincipalExpansionPromisesByKey.delete(principalKey);
    }
  }

  private async resolveGrantEffect(grant: AccessGrantRow): Promise<{
    grant: AccessGrantRow;
    grantedRecipients: GrantedRecipientWithObjectIdRow[];
    referencedPrincipals: ReferencedPrincipalStateResponse[];
  } | null> {
    if (!isAccessLevel(grant.accessLevel)) {
      return null;
    }

    if (grant.subjectType === "user") {
      const recipient = this.directUserGrantRecipientsById.get(grant.subjectId);

      if (!recipient) {
        throw new ContainerCryptoRecipientResolutionError(
          missingDirectUserRecipientMessage(grant.subjectId),
        );
      }

      return {
        grant,
        grantedRecipients: [
          {
            objectId: grant.objectId,
            userId: recipient.userId,
            accessLevel: grant.accessLevel,
            encapsulationPublicKey: recipient.encapsulationPublicKey,
            encapsulationKeyFingerprint: recipient.encapsulationKeyFingerprint,
          },
        ],
        referencedPrincipals: [],
      };
    }

    if (!isManagedPrincipalType(grant.subjectType)) {
      throw new ContainerCryptoRecipientResolutionError(
        `Unsupported container grant subject type ${grant.subjectType}`,
      );
    }

    const expansion = await this.expandManagedPrincipal(
      grant.subjectType,
      grant.subjectId,
    );

    return {
      grant,
      grantedRecipients: expansion.userRecipients.map((recipient) => ({
        objectId: grant.objectId,
        userId: recipient.userId,
        accessLevel: grant.accessLevel,
        encapsulationPublicKey: recipient.encapsulationPublicKey,
        encapsulationKeyFingerprint: recipient.encapsulationKeyFingerprint,
      })),
      referencedPrincipals: expansion.referencedPrincipals,
    };
  }
}
