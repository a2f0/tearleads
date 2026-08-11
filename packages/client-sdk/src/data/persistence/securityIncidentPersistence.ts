import {
  isKeyingVerificationCode,
  type KeyingVerificationCode,
} from "@tearleads/crypto";
import { desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  readonly trustDomain: string | null;
  readonly code: KeyingVerificationCode;
  readonly operation: string;
  readonly objectKind: SecurityIncidentObjectKind;
  readonly objectId: string | null;
  readonly organizationId?: string | null | undefined;
  readonly evidenceHashes?: Readonly<Record<string, string>> | undefined;
  readonly detectedAt: string;
  readonly lastDetectedAt: string;
  readonly occurrenceCount: number;
}

const SECURITY_INCIDENT_RETENTION_LIMIT = 1_000;

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
  return "unrecognized_verification_code";
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function deriveSecurityIncidentId(input: {
  readonly code: KeyingVerificationCode;
  readonly evidenceHashes: string;
  readonly objectId: string | null;
  readonly objectKind: SecurityIncidentObjectKind;
  readonly operation: string;
  readonly organizationId: string | null;
  readonly trustDomain: string | null;
}): Promise<string> {
  const canonicalIdentity = JSON.stringify([
    input.trustDomain,
    input.code,
    input.operation,
    input.objectKind,
    input.objectId,
    input.organizationId,
    input.evidenceHashes,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalIdentity),
  );
  return `incident_v1_${bytesToHex(new Uint8Array(digest))}`;
}

function parseSecurityIncidentRow(
  row: typeof securityIncidents.$inferSelect,
): SecurityIncident {
  return {
    ...row,
    code: parseVerificationCode(row.code),
    evidenceHashes: parseEvidenceHashes(row.evidenceHashes),
    objectKind: parseObjectKind(row.objectKind),
    trustDomain: row.trustDomain,
  };
}

export async function appendSecurityIncident(
  execSql: ExecSql,
  incident: SecurityIncidentWrite,
): Promise<SecurityIncident | null> {
  await ensureSecurityIncidentTable(execSql);
  const runtime = getClientSQLitePersistenceRuntime(execSql);
  const evidenceHashes = serializeEvidenceHashes(incident.evidenceHashes);
  const organizationId = incident.organizationId ?? null;
  const id = await deriveSecurityIncidentId({
    code: incident.code,
    evidenceHashes,
    objectId: incident.objectId,
    objectKind: incident.objectKind,
    operation: incident.operation,
    organizationId,
    trustDomain: incident.trustDomain,
  });
  const row = await runtime.transaction(async (tx) => {
    await tx
      .insert(securityIncidents)
      .values({
        ...incident,
        evidenceHashes,
        id,
        organizationId,
        trustDomain: incident.trustDomain,
      })
      .onConflictDoUpdate({
        target: securityIncidents.id,
        set: {
          lastDetectedAt: sql`max(${securityIncidents.lastDetectedAt}, ${incident.lastDetectedAt})`,
          occurrenceCount: sql`${securityIncidents.occurrenceCount} + ${incident.occurrenceCount}`,
        },
      })
      .run();
    const trustDomainCondition =
      incident.trustDomain === null
        ? isNull(securityIncidents.trustDomain)
        : eq(securityIncidents.trustDomain, incident.trustDomain);
    const staleRows = await tx
      .select({ id: securityIncidents.id })
      .from(securityIncidents)
      .where(trustDomainCondition)
      .orderBy(
        desc(securityIncidents.lastDetectedAt),
        desc(securityIncidents.id),
      )
      .limit(1)
      .offset(SECURITY_INCIDENT_RETENTION_LIMIT);
    // Each call can add at most one distinct row, so deleting the single 1,001st
    // row restores the cap. A future bulk writer must delete its whole excess.
    if (staleRows.length > 0) {
      await tx
        .delete(securityIncidents)
        .where(
          inArray(
            securityIncidents.id,
            staleRows.map((staleRow) => staleRow.id),
          ),
        )
        .run();
    }
    const [storedRow] = await tx
      .select()
      .from(securityIncidents)
      .where(eq(securityIncidents.id, id))
      .limit(1);
    return storedRow;
  });
  return row ? parseSecurityIncidentRow(row) : null;
}

export async function listSecurityIncidents(
  execSql: ExecSql,
  trustDomain: string | null,
): Promise<SecurityIncident[]> {
  await ensureSecurityIncidentTable(execSql);
  const { db } = getClientSQLitePersistenceRuntime(execSql);
  const rows = await db
    .select()
    .from(securityIncidents)
    .where(
      trustDomain === null
        ? isNull(securityIncidents.trustDomain)
        : eq(securityIncidents.trustDomain, trustDomain),
    )
    .orderBy(desc(securityIncidents.lastDetectedAt), desc(securityIncidents.id))
    .limit(SECURITY_INCIDENT_RETENTION_LIMIT);
  return rows.map(parseSecurityIncidentRow);
}
