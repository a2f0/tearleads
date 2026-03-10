export function normalizeChannels(channels: string[]): string[] {
  const unique = new Set(channels);
  return [...unique].sort((left, right) => left.localeCompare(right));
}

export function areSameChannels(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

export function diffChannels(
  previousChannels: string[],
  nextChannels: string[]
): {
  added: string[];
  removed: string[];
} {
  const previousChannelSet = new Set(previousChannels);
  const nextChannelSet = new Set(nextChannels);
  const added = nextChannels.filter(
    (channel) => !previousChannelSet.has(channel)
  );
  const removed = previousChannels.filter(
    (channel) => !nextChannelSet.has(channel)
  );
  return {
    added,
    removed
  };
}
