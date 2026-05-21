import type {
  TearleadsIdentity,
  TearleadsIdentityKeyPackage,
  TearleadsSessionContext,
} from "@tearleads/client-sdk";
import { isPlainObject } from "@tearleads/validators/isPlainObject";

interface AppKeyPackageSession {
  readonly containerId: string;
  readonly organizationId: string;
  readonly userId: string;
}

type AppKeyPackage = TearleadsIdentityKeyPackage & {
  readonly session?: AppKeyPackageSession;
};

interface CreateAppKeyPackageBackupInput {
  readonly identity: Pick<TearleadsIdentity, "exportKeyPackage">;
  readonly session: Pick<
    TearleadsSessionContext,
    "containerId" | "organizationId" | "userId"
  >;
}

function hasCompleteSession(
  session: CreateAppKeyPackageBackupInput["session"],
): session is AppKeyPackageSession {
  return (
    typeof session.containerId === "string" &&
    session.containerId.length > 0 &&
    typeof session.organizationId === "string" &&
    session.organizationId.length > 0 &&
    typeof session.userId === "string" &&
    session.userId.length > 0
  );
}

function readStringProperty(value: object, property: string): string | null {
  const rawValue = Reflect.get(value, property);
  return typeof rawValue === "string" && rawValue.length > 0 ? rawValue : null;
}

export async function createAppKeyPackageBackup({
  identity,
  session,
}: CreateAppKeyPackageBackupInput): Promise<AppKeyPackage> {
  const identityPackage = await identity.exportKeyPackage();

  if (!hasCompleteSession(session)) {
    return identityPackage;
  }

  return {
    ...identityPackage,
    session: {
      containerId: session.containerId,
      organizationId: session.organizationId,
      userId: session.userId,
    },
  };
}

export function readAppKeyPackageSession(
  value: unknown,
): AppKeyPackageSession | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const session = Reflect.get(value, "session");
  if (!isPlainObject(session)) {
    return null;
  }

  const containerId = readStringProperty(session, "containerId");
  const organizationId = readStringProperty(session, "organizationId");
  const userId = readStringProperty(session, "userId");

  return containerId && organizationId && userId
    ? { containerId, organizationId, userId }
    : null;
}

export function createKeyPackageFileName(
  keyPackage: TearleadsIdentityKeyPackage,
): string {
  return `tearleads-key-package-${keyPackage.signingFingerprint.slice(
    0,
    12,
  )}.json`;
}

export function downloadKeyPackageFile(input: {
  readonly fileName: string;
  readonly keyPackage: AppKeyPackage;
}): void {
  const blob = new Blob([`${JSON.stringify(input.keyPackage, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = input.fileName;
  anchor.href = url;
  anchor.rel = "noopener";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseKeyPackageFileText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error("Key package backup must be valid JSON.", {
      cause: error,
    });
  }
}
