import { principalPolicyEntryForReference } from "./principalPolicyReference";
import { throwVerification } from "./shared";
import type {
  AnyVerifiedPrincipalPolicy,
  ContainerAccessLevel,
  ContainerAccessManifestState,
  ContainerDirectGrant,
  ReferencedPrincipalHead,
  VerifiedContainerAccessManifest,
} from "./types";

export function containerAccessLevelRank(
  accessLevel: ContainerAccessLevel,
): number {
  if (accessLevel === "admin") {
    return 3;
  }

  if (accessLevel === "write") {
    return 2;
  }

  return 1;
}

export function mergeContainerAccessLevel(
  current: ContainerAccessLevel | null,
  incoming: ContainerAccessLevel,
): ContainerAccessLevel {
  if (
    current === null ||
    containerAccessLevelRank(incoming) > containerAccessLevelRank(current)
  ) {
    return incoming;
  }

  return current;
}

export function principalPolicyMatchesReference(input: {
  readonly policy: AnyVerifiedPrincipalPolicy;
  readonly reference: ReferencedPrincipalHead;
}): boolean {
  return principalPolicyEntryForReference(input) !== undefined;
}

export function grantAccessLevelForUser(input: {
  readonly grant: ContainerDirectGrant;
  readonly membershipAt: "current" | "referenced";
  readonly principalPolicies: readonly AnyVerifiedPrincipalPolicy[];
  readonly state: Pick<
    ContainerAccessManifestState,
    "referencedPrincipalHeads"
  >;
  readonly userId: string;
}): ContainerAccessLevel | null {
  if (input.grant.subjectType === "user") {
    return input.grant.subjectId === input.userId
      ? input.grant.accessLevel
      : null;
  }

  const referencedHead = input.state.referencedPrincipalHeads.find(
    (principalHead) =>
      principalHead.principalType === input.grant.subjectType &&
      principalHead.principalId === input.grant.subjectId,
  );

  if (!referencedHead) {
    return null;
  }

  const verifiedPolicy = input.principalPolicies.find((policy) =>
    principalPolicyMatchesReference({ policy, reference: referencedHead }),
  );
  if (!verifiedPolicy) {
    return null;
  }
  const projection =
    input.membershipAt === "current"
      ? verifiedPolicy.projection
      : principalPolicyEntryForReference({
          policy: verifiedPolicy,
          reference: referencedHead,
        })?.projection;

  return projection?.some((member) => member.userId === input.userId)
    ? input.grant.accessLevel
    : null;
}

function resolveContainerPathUserAccessLevelAt(input: {
  readonly membershipAt: "current" | "referenced";
  readonly path: readonly Pick<VerifiedContainerAccessManifest, "state">[];
  readonly principalPolicies?: readonly AnyVerifiedPrincipalPolicy[];
  readonly userId: string;
}): ContainerAccessLevel | null {
  let accessLevel: ContainerAccessLevel | null = null;

  for (const containerManifest of input.path) {
    for (const grant of containerManifest.state.directGrants) {
      const grantAccessLevel = grantAccessLevelForUser({
        grant,
        membershipAt: input.membershipAt,
        principalPolicies: input.principalPolicies ?? [],
        state: containerManifest.state,
        userId: input.userId,
      });

      if (grantAccessLevel) {
        accessLevel = mergeContainerAccessLevel(accessLevel, grantAccessLevel);
      }
    }
  }

  return accessLevel;
}

export function resolveContainerPathUserAccessLevel(
  input: Omit<
    Parameters<typeof resolveContainerPathUserAccessLevelAt>[0],
    "membershipAt" | "path"
  > & { readonly path: readonly VerifiedContainerAccessManifest[] },
): ContainerAccessLevel | null {
  return resolveContainerPathUserAccessLevelAt({
    ...input,
    membershipAt: "current",
  });
}

export function resolveHistoricalContainerPathUserAccessLevel(
  input: Omit<
    Parameters<typeof resolveContainerPathUserAccessLevelAt>[0],
    "membershipAt" | "path"
  > & { readonly path: readonly VerifiedContainerAccessManifest[] },
): ContainerAccessLevel | null {
  return resolveContainerPathUserAccessLevelAt({
    ...input,
    membershipAt: "referenced",
  });
}

export function requireContainerPathUserAccess(input: {
  readonly membershipAt?: "current" | "referenced";
  readonly label: string;
  readonly minimumAccessLevel: ContainerAccessLevel;
  readonly path: readonly VerifiedContainerAccessManifest[] | undefined;
  readonly principalPolicies: readonly AnyVerifiedPrincipalPolicy[];
  readonly userId: string;
}): void {
  const path = input.path;
  if (!path || path.length === 0) {
    throwVerification("missing_dependency", `${input.label} path is required`);
  }

  const accessLevel = resolveContainerPathUserAccessLevelAt({
    membershipAt: input.membershipAt ?? "current",
    path,
    principalPolicies: input.principalPolicies,
    userId: input.userId,
  });

  if (
    accessLevel === null ||
    containerAccessLevelRank(accessLevel) <
      containerAccessLevelRank(input.minimumAccessLevel)
  ) {
    throwVerification(
      "unauthorized",
      `${input.label} signer lacks ${input.minimumAccessLevel} access`,
    );
  }
}

/**
 * Calculates current access from already-trusted states. This does not verify
 * signatures, brand manifests, or advance checkpoints. Locally acknowledged
 * plans and verified projections can both supply those immutable states.
 */
export function resolveContainerStatePathUserAccessLevel(input: {
  readonly states: readonly ContainerAccessManifestState[];
  readonly principalPolicies: readonly AnyVerifiedPrincipalPolicy[];
  readonly userId: string;
}): ContainerAccessLevel | null {
  return resolveContainerPathUserAccessLevelAt({
    membershipAt: "current",
    path: input.states.map((state) => ({ state })),
    principalPolicies: input.principalPolicies,
    userId: input.userId,
  });
}
