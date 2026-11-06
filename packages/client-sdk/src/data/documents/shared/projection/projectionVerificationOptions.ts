import type {
  ProjectionUserKeyResolver,
  ReferencedPrincipalPolicyWarmer,
} from "../../../keyingProjectionVerification";
import { requireProjectionUserKeyResolver } from "../../../keyingProjectionVerification";
import type { ExecSql } from "../../../sqlite/sqlSchema";

interface ProjectionVerificationBase {
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

export type ProjectionVerificationOptions = ProjectionVerificationBase &
  (
    | {
        readonly execSql: ExecSql;
        readonly resolveProjectionUserKey: ProjectionUserKeyResolver;
        readonly trustedLocalProjection?: undefined;
      }
    | {
        readonly execSql?: ExecSql | undefined;
        readonly resolveProjectionUserKey?: undefined;
        readonly trustedLocalProjection: true;
      }
  );

export function resolveProjectionVerifier(
  input: ProjectionVerificationOptions,
  label: string,
): ProjectionUserKeyResolver | null {
  if (input.resolveProjectionUserKey) {
    if (input.trustedLocalProjection === true) {
      throw new Error(
        `${label} cannot combine projection key verification with local projection trust`,
      );
    }
    return requireProjectionUserKeyResolver(
      input.resolveProjectionUserKey,
      label,
    );
  }
  if (input.trustedLocalProjection === true) {
    return null;
  }
  throw new Error(
    `${label} requires projection key verification or an explicitly trusted local projection`,
  );
}

export function projectionVerificationOptions(
  input: ProjectionVerificationOptions,
): ProjectionVerificationOptions {
  const warm = input.warmReferencedPrincipalPolicies;
  const shared = {
    ...(input.stillCurrent ? { stillCurrent: input.stillCurrent } : {}),
    ...(warm ? { warmReferencedPrincipalPolicies: warm } : {}),
  };
  if (input.resolveProjectionUserKey) {
    if (input.trustedLocalProjection === true) {
      throw new Error(
        "Projection use cannot combine key verification with local projection trust",
      );
    }
    return {
      execSql: input.execSql,
      ...shared,
      resolveProjectionUserKey: input.resolveProjectionUserKey,
    };
  }
  if (input.trustedLocalProjection === true) {
    return input.execSql
      ? {
          execSql: input.execSql,
          ...shared,
          trustedLocalProjection: true,
        }
      : { ...shared, trustedLocalProjection: true };
  }

  throw new Error(
    "Projection use requires key verification or an explicitly trusted local projection",
  );
}
