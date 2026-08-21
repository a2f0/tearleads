import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
} from "@symcrypt/crypto";
import type { Identity } from "../../src/client/identity";
import type { Logger } from "../../src/client/logger";
import type { ExecSql, ExecSqlClientLike } from "../../src/sqlite";

export const quietLogger: {
  log: NonNullable<Logger["log"]>;
  logError: NonNullable<Logger["logError"]>;
} = {
  log: () => undefined,
  logError: () => undefined,
};

export function createSqlClient(
  execSql: ExecSql,
  onExec?: () => void,
): ExecSqlClientLike {
  return {
    async exec({ bind, rowMode, sql }) {
      onExec?.();
      return {
        rows: await execSql(sql, bind, rowMode ? { rowMode } : undefined),
      };
    },
  };
}

/** Installs freshly generated encapsulation and signing key pairs. */
export function setGeneratedIdentity(identity: Identity) {
  return identity.setKeyPairs({
    encapsulationKeyPair: generateKemSeedAndKeyPair(),
    signingKeyPair: generateSigningSeedAndKeyPair(),
  });
}
