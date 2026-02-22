type CreateAccountInput = {
  email: string;
  password: string;
};

const PERSONAL_ORGANIZATION_ID_PREFIX = 'personal-org-';

export function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    throw new Error('Email is required.');
  }
  return normalized;
}

export function normalizePassword(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error('Password is required.');
  }
  return normalized;
}

export function buildCreateAccountInput(
  email: string,
  password: string
): CreateAccountInput {
  return {
    email: normalizeEmail(email),
    password: normalizePassword(password)
  };
}

export function buildPersonalOrganizationId(userId: string): string {
  return `${PERSONAL_ORGANIZATION_ID_PREFIX}${userId}`;
}

export function buildPersonalOrganizationName(userId: string): string {
  return `Personal ${userId}`;
}
