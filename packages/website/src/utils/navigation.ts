interface LocationNavigator {
  assign: (path: string) => void;
}

export function navigateToPath(
  path: string,
  locationNavigator: LocationNavigator
): void {
  locationNavigator.assign(path);
}
