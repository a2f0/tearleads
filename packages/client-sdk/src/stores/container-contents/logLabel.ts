export function getContainerContentsStoreLogLabel(state: {
  logLabel?: string | undefined;
}): string {
  return state.logLabel ?? "Container contents";
}
