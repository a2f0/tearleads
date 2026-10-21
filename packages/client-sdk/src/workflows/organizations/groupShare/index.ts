// Sharing a container with a group commits a grant to the group's principal
// policy and re-wraps the container under it.
export { createRuntimeCurrentSharePrincipalPolicy } from "./currentSharePrincipalPolicy";
export { createRuntimeCurrentGroupShare } from "./runtimeCurrentGroupShare";
export { GroupShareNameMismatchError } from "./sharePrincipalPolicy";
export { shareRemoteContainerWithGroup } from "./shareWithGroup";
