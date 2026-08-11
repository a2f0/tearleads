import {
  isKeyingVerificationCode,
  type KeyingVerificationCode,
} from "@tearleads/crypto";
import { desc } from "drizzle-orm";
import type {
  SecurityIncident,
  SecurityIncidentObjectKind,
} from "../securityIncidents";
import {
  securityIncidents,
  securityIncidentTable,
} from "../sqlite/securityIncidentSchema";
import { getClientSQLitePersistenceRuntime } from "../sqlite/sqlitePersistenceRuntime";
import { type ExecSql, ensureSqlTables } from "../sqlite/sqlSchema";

interface SecurityIncidentWrite {
  readonly id: string;
  readonly trustDomain: string | null;
  readonly code: KeyingVerificationCode;
  readonly operation: string;
  readonly objectKind: SecurityIncidentObjectKind;
  readonly objectId: string | null;
  readonly organizationId?: string | null | undefined;
  readonly evidenceHashes?: Readonly<Record<string, string>> | undefined;
  readonly detectedAt: string;
}

function serializeEvidenceHashes(
  evidenceHashes: Readonly<Record<string, string>> | undefined,
): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(evidenceHashes ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

function parseEvidenceHashes(value: string): Readonly<Record<string, string>> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Security incident evidence hashes are invalid");
  }
  const evidenceHashes: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (key.length === 0 || typeof item !== "string") {
      throw new Error("Security incident evidence hashes are invalid");
    }
    evidenceHashes[key] = item;
  }
  return evidenceHashes;
}

function parseVerificationCode(value: string): KeyingVerificationCode {
  if (isKeyingVerificationCode(value)) return value;
  throw new Error("Security incident verification code is invalid");
}

function parseObjectKind(value: string): SecurityIncidentObjectKind {
  switch (value) {
    case "blob":
    case "container":
    case "document":
    case "principal":
    case "user":
    case "unknown":
      return value;
    default:
      throw new Error("Security incident object kind is invalid");
  }
}

async function ensureSecurityIncidentTable(execSql: ExecSql): Promise<void> {
  await ensureSqlTables(execSql, [securityIncidentTable]);
}

export async function appendSecurityIncident(
  execSql: ExecSql,
  incident: SecurityIncidentWrite,
): Promise<SecurityIncident> {
  await ensureSecurityIncidentTable(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const evidenceHashes = serializeEvidenceHashes(incident.evidenceHashes);
  await db
    .insert(securityIncidents)
    .values({
      ...incident,
      evidenceHashes,
      organizationId: incident.organizationId ?? null,
      trustDomain: incident.trustDomain,
    })
    .run();
  return {
    ...incident,
    evidenceHashes: incident.evidenceHashes ?? {},
    organizationId: incident.organizationId ?? null,
  };
}

export async function listSecurityIncidents(
  execSql: ExecSql,
): Promise<SecurityIncident[]> {
  await ensureSecurityIncidentTable(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select()
    .from(securityIncidents)
    .orderBy(desc(securityIncidents.detectedAt), desc(securityIncidents.id));
  return rows.map((row) => ({
    ...row,
    code: parseVerificationCode(row.code),
    evidenceHashes: parseEvidenceHashes(row.evidenceHashes),
    objectKind: parseObjectKind(row.objectKind),
    trustDomain: row.trustDomain,
  }));
}
