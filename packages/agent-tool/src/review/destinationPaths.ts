import {
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";

function portableCollisionKey(relativePath: string): string {
  return relativePath.normalize("NFC").toLowerCase().normalize("NFC");
}

export function destinationFor(rootDir: string, relativePath: string): string {
  const resolvedRoot = path.resolve(rootDir);
  const destination = path.resolve(resolvedRoot, ...relativePath.split("/"));
  const relativeDestination = path.relative(resolvedRoot, destination);
  if (
    relativeDestination === "" ||
    relativeDestination === ".." ||
    relativeDestination.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeDestination)
  ) {
    throw new Error(
      `Unsafe destination in reviewed Git tree: ${JSON.stringify(relativePath)}`,
    );
  }
  return destination;
}

function collision(prior: string, candidate: string): never {
  throw new Error(
    `Colliding paths in reviewed Git tree: ${JSON.stringify(prior)} and ${JSON.stringify(candidate)}`,
  );
}

function nodeIdentity(destination: string): string {
  const stats = lstatSync(destination);
  return `${stats.dev}:${stats.ino}`;
}

function priorFilesystemAlias(
  destination: string,
  identities: ReadonlyMap<string, string>,
): string | undefined {
  try {
    return identities.get(nodeIdentity(destination));
  } catch {
    return undefined;
  }
}

function assertExactStoredName(
  destination: string,
  relativePath: string,
): void {
  const expectedName = Buffer.from(relativePath.split("/").at(-1) ?? "");
  const exactNameExists = readdirSync(path.dirname(destination), {
    encoding: "buffer",
  }).some((name) => Buffer.compare(Buffer.from(name), expectedName) === 0);
  if (!exactNameExists) {
    throw new Error(
      `Destination filesystem rewrote reviewed Git path: ${JSON.stringify(relativePath)}`,
    );
  }
}

function probeDestinationFilesystem(
  rootDir: string,
  relativePaths: string[],
): void {
  if (relativePaths.length === 0) {
    return;
  }
  const directories = new Set<string>();
  for (const relativePath of relativePaths) {
    const segments = relativePath.split("/");
    for (let end = 1; end < segments.length; end += 1) {
      directories.add(segments.slice(0, end).join("/"));
    }
  }
  const nodes = new Map<string, boolean>();
  for (const directory of directories) {
    nodes.set(directory, true);
  }
  for (const relativePath of relativePaths) {
    if (nodes.has(relativePath)) {
      collision(relativePath, relativePath);
    }
    nodes.set(relativePath, false);
  }
  const orderedNodes = [...nodes].sort(([left], [right]) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || Buffer.compare(Buffer.from(left), Buffer.from(right));
  });
  const probeRoot = mkdtempSync(
    path.join(rootDir, ".agent-tool-destination-probe-"),
  );
  const identities = new Map<string, string>();
  try {
    for (const [relativePath, isDirectory] of orderedNodes) {
      const destination = destinationFor(probeRoot, relativePath);
      try {
        if (isDirectory) {
          mkdirSync(destination);
        } else {
          closeSync(openSync(destination, "wx"));
        }
      } catch (error) {
        const prior = priorFilesystemAlias(destination, identities);
        if (prior !== undefined) {
          collision(prior, relativePath);
        }
        throw new Error(
          `Destination filesystem rejected reviewed Git path: ${JSON.stringify(relativePath)}`,
          { cause: error },
        );
      }
      const identity = nodeIdentity(destination);
      const prior = identities.get(identity);
      if (prior !== undefined && prior !== relativePath) {
        collision(prior, relativePath);
      }
      identities.set(identity, relativePath);
      assertExactStoredName(destination, relativePath);
    }
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
}

/** Reject paths that alias lexically or on the actual snapshot filesystem. */
export function validateDestinationPaths(
  rootDir: string,
  relativePaths: string[],
): void {
  const seenPaths = new Map<string, string>();
  for (const relativePath of relativePaths) {
    const segments = relativePath.split("/");
    for (let end = 1; end <= segments.length; end += 1) {
      const candidate = segments.slice(0, end).join("/");
      const key = portableCollisionKey(candidate);
      const prior = seenPaths.get(key);
      if (prior !== undefined && prior !== candidate) {
        collision(prior, candidate);
      }
      seenPaths.set(key, candidate);
    }
    destinationFor(rootDir, relativePath);
  }
  probeDestinationFilesystem(rootDir, relativePaths);
}
