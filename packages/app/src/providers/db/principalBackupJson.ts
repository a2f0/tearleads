import { normalizePrincipalProjectionMembers } from "@tearleads/crypto";
import { isPlainObject } from "@tearleads/validators/isPlainObject";
import {
  isCommitOrganizationGroupPolicyRequest,
  isCreateOrganizationGroupRequest,
  isCreateOrganizationGroupWithPolicyRequest,
  isDeleteOrganizationGroupRequest,
  isOrganizationPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import {
  isPrincipalPolicyBundleResponse,
  isPrincipalPolicyStateChainEntryResponse,
  isReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import type { BackupSqlRow } from "./localBackupPayload";

const HEAD_FIELDS = new Set([
  "principalType",
  "principalId",
  "version",
  "keyEpoch",
  "keyFingerprint",
  "stateHash",
]);

function requireShape(valid: boolean): asserts valid {
  if (!valid) throw new Error("Invalid principal backup JSON");
}

function readJson(row: BackupSqlRow, column: string): unknown {
  const value = row[column];
  requireShape(typeof value === "string");
  return JSON.parse(value);
}

function validateProjection(value: unknown): void {
  requireShape(Array.isArray(value));
  normalizePrincipalProjectionMembers(
    value.map((member: unknown) => {
      requireShape(isPlainObject(member));
      const { userId, role, identityBundleFingerprint } = member;
      requireShape(
        typeof userId === "string" &&
          (role === "admin" || role === "member") &&
          typeof identityBundleFingerprint === "string",
      );
      return { userId, role, identityBundleFingerprint };
    }),
  );
}

// Request/artifact objects can nest several distinct policies. Inspect every
// embedded projection, including extension fields preserved by loose validators.
function validateEmbeddedProjections(value: unknown): void {
  const pending = [value];
  while (pending.length) {
    const next = pending.pop();
    if (Array.isArray(next)) pending.push(...next);
    else if (isPlainObject(next)) {
      for (const [key, child] of Object.entries(next)) {
        if (key === "projection" || key === "currentProjection")
          validateProjection(child);
        else pending.push(child);
      }
    }
  }
}

function validateHead(value: unknown): void {
  requireShape(isReferencedPrincipalStateResponse(value));
  // The response validator permits extensions; public metadata never writes them.
  requireShape(Object.keys(value).every((key) => HEAD_FIELDS.has(key)));
}

function validateCurrent(value: unknown): void {
  if (value === null) return;
  if (isPlainObject(value) && "principalType" in value) {
    validateHead(value);
    return;
  }
  requireShape(isPlainObject(value));
  requireShape(
    isPrincipalPolicyBundleResponse({ ...value, previousStates: [] }),
  );
  validateEmbeddedProjections(value);
}

function validateJournal(value: unknown): void {
  requireShape(isPlainObject(value));
  const { kind, request } = value;
  switch (kind) {
    case "organization":
      requireShape(isOrganizationPrincipalPolicyRequest(request));
      break;
    case "compound":
      requireShape(isCommitOrganizationGroupPolicyRequest(request));
      break;
    case "group-create":
      requireShape(isCreateOrganizationGroupWithPolicyRequest(request));
      break;
    case "group-delete":
      requireShape(isDeleteOrganizationGroupRequest(request));
      break;
    default:
      requireShape(false);
  }
  validateEmbeddedProjections(value);
}

export function validatePrincipalBackupJson(
  name: string,
  row: BackupSqlRow,
): void {
  switch (name) {
    case "principal_policy_bundles": {
      const bundle = {
        currentState: readJson(row, "current_state_json"),
        currentPayload: readJson(row, "current_payload_json"),
        currentProjection: readJson(row, "current_projection_json"),
        currentGrants: readJson(row, "current_grants_json"),
        currentMemberEnvelopes: readJson(row, "current_member_envelopes_json"),
        previousStates: readJson(row, "previous_states_json"),
      };
      requireShape(isPrincipalPolicyBundleResponse(bundle));
      validateEmbeddedProjections(bundle);
      return;
    }
    case "principal_history_prefixes":
      validateHead(readJson(row, "head_json"));
      validateCurrent(readJson(row, "current_json"));
      return;
    case "principal_history_stages":
      validateCurrent(readJson(row, "current_json"));
      return;
    case "principal_history_entries": {
      const entry = readJson(row, "entry_json");
      requireShape(isPrincipalPolicyStateChainEntryResponse(entry));
      validateEmbeddedProjections(entry);
      return;
    }
    case "principal_mutation_journal":
      validateJournal(readJson(row, "serialized_request"));
      return;
    case "organization_provisioning_attempts": {
      const artifacts = readJson(row, "serialized_artifacts");
      requireShape(isPlainObject(artifacts));
      const {
        initialAdminGroup,
        initialMemberGroup,
        initialOrganizationPolicy,
      } = artifacts;
      requireShape(isCreateOrganizationGroupRequest(initialAdminGroup));
      requireShape(isCreateOrganizationGroupRequest(initialMemberGroup));
      requireShape(
        isOrganizationPrincipalPolicyRequest(initialOrganizationPolicy),
      );
      validateEmbeddedProjections(artifacts);
    }
  }
  // History progress is opaque authenticated ciphertext, not a JSON cache.
  // Its verification revision is enforced by the crypto progress opener.
}
