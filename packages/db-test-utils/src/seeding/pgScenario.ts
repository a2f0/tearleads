import { randomUUID } from 'node:crypto';
import {
  type HarnessSqlClient,
  type SeedHarnessAccountInput,
  type SeedHarnessAccountResult,
  seedHarnessAccount
} from './pgAccount.js';
import { buildRevenueCatAppUserId } from './pgAccountHelpers.js';

export type { HarnessSqlClient };

export interface HarnessActorDefinition {
  alias: string;
  email: string;
  password: string;
  admin?: boolean;
}

export interface HarnessActor extends SeedHarnessAccountResult {
  alias: string;
  email: string;
}

export interface HarnessActorsResult {
  actors: HarnessActor[];
  byAlias: Record<string, HarnessActor>;
}

export interface HarnessOrganizationSeedInput {
  name: string;
  description?: string | null | undefined;
  memberUserIds?: string[];
  adminUserIds?: string[];
}

export interface HarnessOrganization {
  id: string;
  name: string;
  description: string | null;
}

export interface HarnessGroupSeedInput {
  organizationId: string;
  name: string;
  description?: string | null | undefined;
  memberUserIds?: string[];
}

export interface HarnessGroup {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
}

export interface HarnessOrganizationDefinition {
  key: string;
  name: string;
  description?: string | null;
  members?: string[];
  admins?: string[];
}

export interface HarnessGroupDefinition {
  key: string;
  organizationKey: string;
  name: string;
  description?: string | null;
  members?: string[];
}

export interface SeedVfsScenarioInput {
  actors: HarnessActorDefinition[];
  organizations?: HarnessOrganizationDefinition[];
  groups?: HarnessGroupDefinition[];
  includeVfsOnboardingKeys?: boolean;
}

export interface SeedVfsScenarioResult {
  actors: HarnessActorsResult;
  organizationsByKey: Record<string, HarnessOrganization>;
  groupsByKey: Record<string, HarnessGroup>;
}

function assertUniqueNames(values: string[], label: string): void {
  const unique = new Set(values);
  if (unique.size !== values.length) {
    throw new Error(`Duplicate ${label} values are not allowed.`);
  }
}

function assertNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}

function resolveActorIds(
  aliases: string[] | undefined,
  byAlias: Record<string, HarnessActor>,
  label: string
): string[] {
  if (!aliases || aliases.length === 0) {
    return [];
  }

  return aliases.map((alias) => {
    const actor = byAlias[alias];
    if (!actor) {
      throw new Error(`Unknown actor alias "${alias}" in ${label}.`);
    }
    return actor.userId;
  });
}

async function insertOrganization(
  client: HarnessSqlClient,
  input: HarnessOrganizationSeedInput
): Promise<HarnessOrganization> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const name = assertNonEmpty(input.name, 'Organization name');
  const description = input.description?.trim() || null;
  const revenueCatAppUserId = buildRevenueCatAppUserId(id);

  await client.query(
    `INSERT INTO organizations (
       id,
       name,
       description,
       is_personal,
       created_at,
       updated_at
     ) VALUES ($1, $2, $3, false, $4, $4)`,
    [id, name, description, now]
  );

  await client.query(
    `INSERT INTO organization_billing_accounts (
       organization_id,
       revenuecat_app_user_id,
       entitlement_status,
       created_at,
       updated_at
     ) VALUES ($1, $2, 'inactive', $3, $3)`,
    [id, revenueCatAppUserId, now]
  );

  const adminUserIds = new Set(input.adminUserIds ?? []);
  const allMemberUserIds = new Set([
    ...(input.memberUserIds ?? []),
    ...(input.adminUserIds ?? [])
  ]);

  for (const userId of allMemberUserIds) {
    await client.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, organization_id)
       DO UPDATE SET is_admin = user_organizations.is_admin OR EXCLUDED.is_admin`,
      [userId, id, now, adminUserIds.has(userId)]
    );
  }

  return {
    id,
    name,
    description
  };
}

async function insertGroup(
  client: HarnessSqlClient,
  input: HarnessGroupSeedInput
): Promise<HarnessGroup> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const name = assertNonEmpty(input.name, 'Group name');
  const description = input.description?.trim() || null;

  await client.query(
    `INSERT INTO groups (
       id,
       organization_id,
       name,
       description,
       created_at,
       updated_at
     ) VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, input.organizationId, name, description, now]
  );

  for (const userId of input.memberUserIds ?? []) {
    await client.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
       VALUES ($1, $2, $3, false)
       ON CONFLICT DO NOTHING`,
      [userId, input.organizationId, now]
    );
    await client.query(
      `INSERT INTO user_groups (user_id, group_id, joined_at)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [userId, id, now]
    );
  }

  return {
    id,
    organizationId: input.organizationId,
    name,
    description
  };
}

export async function createHarnessActors(
  client: HarnessSqlClient,
  actors: HarnessActorDefinition[],
  options?: {
    includeVfsOnboardingKeys?: boolean;
    emailConfirmed?: boolean;
  }
): Promise<HarnessActorsResult> {
  const includeVfsOnboardingKeys = options?.includeVfsOnboardingKeys ?? true;
  const emailConfirmed = options?.emailConfirmed ?? true;

  assertUniqueNames(
    actors.map((actor) => actor.alias),
    'actor alias'
  );

  const seededActors: HarnessActor[] = [];
  for (const actor of actors) {
    const seedInput: SeedHarnessAccountInput = {
      email: actor.email,
      password: actor.password,
      admin: actor.admin ?? false,
      emailConfirmed,
      includeVfsOnboardingKeys
    };
    const seeded = await seedHarnessAccount(client, seedInput);
    seededActors.push({
      alias: assertNonEmpty(actor.alias, 'Actor alias'),
      email: actor.email,
      ...seeded
    });
  }

  const byAlias = Object.fromEntries(
    seededActors.map((actor) => [actor.alias, actor])
  );

  return {
    actors: seededActors,
    byAlias
  };
}

export async function createHarnessOrganization(
  client: HarnessSqlClient,
  input: HarnessOrganizationSeedInput
): Promise<HarnessOrganization> {
  return insertOrganization(client, input);
}

export async function createHarnessGroup(
  client: HarnessSqlClient,
  input: HarnessGroupSeedInput
): Promise<HarnessGroup> {
  return insertGroup(client, input);
}

export async function seedVfsScenario(
  client: HarnessSqlClient,
  input: SeedVfsScenarioInput
): Promise<SeedVfsScenarioResult> {
  const actors = await createHarnessActors(client, input.actors, {
    includeVfsOnboardingKeys: input.includeVfsOnboardingKeys ?? true,
    emailConfirmed: true
  });

  const organizationsByKey: Record<string, HarnessOrganization> = {};
  for (const organization of input.organizations ?? []) {
    const key = assertNonEmpty(organization.key, 'Organization key');
    if (organizationsByKey[key]) {
      throw new Error(`Duplicate organization key "${key}".`);
    }

    const memberUserIds = resolveActorIds(
      organization.members,
      actors.byAlias,
      `organization "${key}" members`
    );
    const adminUserIds = resolveActorIds(
      organization.admins,
      actors.byAlias,
      `organization "${key}" admins`
    );

    const organizationSeedInput: HarnessOrganizationSeedInput = {
      name: organization.name,
      description: organization.description,
      memberUserIds,
      adminUserIds
    };

    organizationsByKey[key] = await createHarnessOrganization(
      client,
      organizationSeedInput
    );
  }

  const groupsByKey: Record<string, HarnessGroup> = {};
  for (const group of input.groups ?? []) {
    const key = assertNonEmpty(group.key, 'Group key');
    if (groupsByKey[key]) {
      throw new Error(`Duplicate group key "${key}".`);
    }
    const organization = organizationsByKey[group.organizationKey];
    if (!organization) {
      throw new Error(
        `Unknown organization key "${group.organizationKey}" for group "${key}".`
      );
    }

    const memberUserIds = resolveActorIds(
      group.members,
      actors.byAlias,
      `group "${key}" members`
    );

    const groupSeedInput: HarnessGroupSeedInput = {
      organizationId: organization.id,
      name: group.name,
      description: group.description,
      memberUserIds
    };

    groupsByKey[key] = await createHarnessGroup(client, groupSeedInput);
  }

  return {
    actors,
    organizationsByKey,
    groupsByKey
  };
}
