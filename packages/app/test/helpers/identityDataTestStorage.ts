import { sqliteDbNameForSigningFingerprint } from "../../src/providers/db/sqliteDbName";

/** OPFS directories exercised through the production SQLite/blob purge helpers. */
export function installIdentityDataTestStorage(
  fingerprints: readonly string[],
) {
  const previousStorage = Object.getOwnPropertyDescriptor(navigator, "storage");
  const databases = new Set(
    fingerprints.map((fp) => sqliteDbNameForSigningFingerprint(fp).slice(1)),
  );
  const blobs = new Set(fingerprints);
  const removals: string[] = [];
  let nextFailure: "blobs" | "sqlite" | null = null;

  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      getDirectory: async () => ({
        async getDirectoryHandle(name: string) {
          const entries =
            name === "tearleads-sqlite"
              ? databases
              : name === "tearleads"
                ? blobs
                : null;
          if (!entries) {
            throw new DOMException("Missing directory", "NotFoundError");
          }
          return {
            async removeEntry(leaf: string, options: { recursive: boolean }) {
              const kind = name === "tearleads-sqlite" ? "sqlite" : "blobs";
              if (!options.recursive) {
                throw new Error("Expected recursive removal");
              }
              if (nextFailure === kind) {
                nextFailure = null;
                throw new Error("Planned OPFS removal failure");
              }
              removals.push(`${kind}/${leaf}`);
              if (!entries.delete(leaf)) {
                throw new DOMException("Missing directory", "NotFoundError");
              }
            },
          };
        },
      }),
    },
  });

  return {
    blobs,
    databases,
    removals,
    failNextRemoval: (kind: "blobs" | "sqlite") => {
      nextFailure = kind;
    },
    restore: () => {
      if (previousStorage) {
        Object.defineProperty(navigator, "storage", previousStorage);
      } else {
        Reflect.deleteProperty(navigator, "storage");
      }
    },
  };
}
