import type { DomainScope } from "../data/domainScope";
import type {
  ContainerContentsRootAdopter,
  ContainerContentsRootAdoptionInput,
} from "../workflows/container-contents/runtime";
import type { Session } from "./session/sessionTypes";

interface RootContainerAdoptionDependencies {
  readonly getDomainScope: () => DomainScope;
  readonly session: Pick<
    Session,
    | "containerId"
    | "isAuthenticated"
    | "organizationId"
    | "setContainerId"
    | "userId"
  >;
}

export function adoptSessionRootContainer(
  dependencies: RootContainerAdoptionDependencies,
  input: ContainerContentsRootAdoptionInput,
): ReturnType<ContainerContentsRootAdopter> {
  const session = dependencies.session;
  if (
    dependencies.getDomainScope() !== input.domainScope ||
    !session.isAuthenticated ||
    session.organizationId !== input.organizationId ||
    session.userId !== input.userId
  ) {
    return false;
  }
  if (session.containerId === input.nextContainerId) {
    return "already-adopted";
  }
  if (session.containerId !== input.expectedContainerId) {
    return false;
  }

  session.setContainerId(input.nextContainerId);
  return true;
}
