import type {
  OrganizationDirectory,
  OrganizationUserDetail,
} from "@symcrypt/client-sdk";
import type { useSymCryptRuntime } from "../../../providers/sdk/SymCryptProvider";

export function getOrgManagerStateScopeKey(
  appData: ReturnType<typeof useSymCryptRuntime>,
): string {
  return JSON.stringify([
    appData.auth.isAuthenticated,
    appData.auth.organizationId,
    appData.auth.userId,
    appData.crypto.signingFingerprint,
    appData.infra.dbId,
    appData.infra.dbStatus,
    appData.state.containerId,
  ]);
}

export function getOrgManagerDataUsageScopeKey(
  appData: ReturnType<typeof useSymCryptRuntime>,
): string {
  return JSON.stringify([
    appData.auth.isAuthenticated,
    appData.auth.organizationId,
    appData.auth.userId,
    appData.infra.dbId,
  ]);
}

export function scopeOrganizationDirectory(
  value: OrganizationDirectory | null,
  organizationId: string | null,
  userId: string | null,
): OrganizationDirectory | null {
  return value?.organizationId === organizationId &&
    value.users.some((user) => user.isSelf && user.userId === userId)
    ? value
    : null;
}

export function scopeOrganizationValue<
  TValue extends { readonly organizationId: string },
>(value: TValue | null, organizationId: string | null): TValue | null {
  return value?.organizationId === organizationId ? value : null;
}

export function scopeOrganizationList<
  TValue extends { readonly organizationId: string },
>(
  values: ReadonlyArray<TValue>,
  organizationId: string | null,
): ReadonlyArray<TValue> {
  return organizationId
    ? values.filter((value) => value.organizationId === organizationId)
    : [];
}

export function scopeSelectedGroupValue<
  TValue extends {
    readonly groupId: string;
    readonly organizationId: string;
  },
>(
  value: TValue | null,
  organizationId: string | null,
  selectedGroupId: string | null,
): TValue | null {
  return value?.organizationId === organizationId &&
    value.groupId === selectedGroupId
    ? value
    : null;
}

export function scopeSelectedUserDetail(
  value: OrganizationUserDetail | null,
  organizationId: string | null,
  selectedUserId: string | null,
): OrganizationUserDetail | null {
  return value?.organizationId === organizationId &&
    value.user.userId === selectedUserId
    ? value
    : null;
}
