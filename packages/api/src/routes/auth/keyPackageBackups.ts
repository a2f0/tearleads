import { isPutKeyPackageBackupRequest } from "@tearleads/validators/request";
import type {
  DeleteKeyPackageBackupResponse,
  KeyPackageBackupResponse,
  ListKeyPackageBackupsResponse,
} from "@tearleads/validators/response";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { validator } from "hono/validator";
import type { SessionEnv } from "../../middleware/session";
import {
  deleteKeyPackageBackup,
  getKeyPackageBackupByCredentialId,
  KeyPackageBackupError,
  listKeyPackageBackups,
  putKeyPackageBackup,
} from "../../services/auth/keyPackageBackups";
import type { ApiServiceRuntime } from "../../services/runtime";

interface KeyPackageBackupsRouteDeps {
  readonly requireAuth: MiddlewareHandler<SessionEnv>;
  readonly runtime: ApiServiceRuntime;
}

function handleKeyPackageBackupError(
  c: {
    json: (value: { error: string }, status: 403 | 404 | 409) => Response;
  },
  error: unknown,
): Response | null {
  if (error instanceof KeyPackageBackupError) {
    return c.json({ error: error.message }, error.status);
  }

  return null;
}

export function createKeyPackageBackupsRoute({
  requireAuth,
  runtime,
}: KeyPackageBackupsRouteDeps) {
  const route = new Hono<SessionEnv>();

  route.get("/auth/key-package-backups", requireAuth, async (c) => {
    const backups = await listKeyPackageBackups(
      runtime,
      c.get("session").userId,
    );
    return c.json<ListKeyPackageBackupsResponse>({ backups });
  });

  route.get(
    "/auth/key-package-backups/by-credential/:credentialId",
    async (c) => {
      const credentialId = c.req.param("credentialId");
      if (!credentialId) {
        return c.json({ error: "Credential id is required" }, 400);
      }

      const backup = await getKeyPackageBackupByCredentialId(
        runtime,
        credentialId,
      );
      if (!backup) {
        return c.json({ error: "Backup not found" }, 404);
      }

      return c.json<KeyPackageBackupResponse>(backup);
    },
  );

  route.put(
    "/auth/key-package-backups/:backupId",
    requireAuth,
    validator("json", (value, c) => {
      if (!isPutKeyPackageBackupRequest(value)) {
        return c.json({ error: "Invalid request" }, 400);
      }
      return value;
    }),
    async (c) => {
      const body = c.req.valid("json");
      if (c.req.param("backupId") !== body.backupId) {
        return c.json({ error: "Backup id mismatch" }, 400);
      }

      try {
        return c.json<KeyPackageBackupResponse>(
          await putKeyPackageBackup(runtime, c.get("session").userId, body),
        );
      } catch (error: unknown) {
        const response = handleKeyPackageBackupError(c, error);
        if (response) {
          return response;
        }
        throw error;
      }
    },
  );

  route.delete(
    "/auth/key-package-backups/:backupId",
    requireAuth,
    async (c) => {
      try {
        await deleteKeyPackageBackup(
          runtime,
          c.get("session").userId,
          c.req.param("backupId"),
        );
        return c.json<DeleteKeyPackageBackupResponse>({ message: "ok" });
      } catch (error: unknown) {
        const response = handleKeyPackageBackupError(c, error);
        if (response) {
          return response;
        }
        throw error;
      }
    },
  );

  return route;
}
