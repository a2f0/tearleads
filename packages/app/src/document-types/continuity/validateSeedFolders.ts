import {
  distinct,
  nonEmptyString,
  optionalArray,
  record,
} from "./seedSpecValues";

const FOLDER_ACCESS = new Set(["read", "write"]);

/** The contact ids of the groups a folder lets write, by group name. */
function writers(
  grants: readonly unknown[],
  groups: readonly unknown[],
): Set<unknown> {
  const writing = new Set(
    grants.flatMap((grant) => {
      if (!record(grant)) return [];
      const { access, group } = grant;
      return access === "write" ? [group] : [];
    }),
  );
  return new Set(
    groups.flatMap((group) => {
      if (!record(group)) return [];
      const { name, members } = group;
      return writing.has(name) && Array.isArray(members) ? members : [];
    }),
  );
}

function validGrants(grants: unknown, groupNames: ReadonlySet<unknown>) {
  return (
    optionalArray(grants, (grant) => {
      if (!record(grant)) return false;
      const { group, access } = grant;
      return groupNames.has(group) && FOLDER_ACCESS.has(String(access));
    }) &&
    (!Array.isArray(grants) ||
      distinct(grants.map(({ group }: { group?: unknown }) => group)))
  );
}

// A note's additions are written by members of a group that can write in its
// folder, so an addition by anyone else would fail only after the owner's
// writes; reject it before the seed writes anything. Each member adds one
// line, which is one change in the note's history.
function validNotes(notes: unknown, authors: ReadonlySet<unknown>) {
  return optionalArray(notes, (note) => {
    if (!record(note)) return false;
    const { text, additions } = note;
    const added = new Set<unknown>();
    return (
      nonEmptyString(text) &&
      optionalArray(additions, (addition) => {
        if (!record(addition)) return false;
        const { author, text: line } = addition;
        if (added.has(author)) return false;
        added.add(author);
        return (
          authors.has(author) && nonEmptyString(line) && line.trim().length > 0
        );
      })
    );
  });
}

/**
 * Folders have distinct plain names; each grant names a seeded group once,
 * with read or write access; and each note addition's author is a member of
 * a group the folder grants write.
 */
export function validSeedFolders(
  folders: unknown,
  groups: readonly unknown[],
): boolean {
  const groupNames = new Set(
    groups.flatMap((group) => {
      if (!record(group)) return [];
      const { name } = group;
      return [name];
    }),
  );
  return (
    optionalArray(folders, (folder) => {
      if (!record(folder)) return false;
      const { name, grants, notes } = folder;
      return (
        nonEmptyString(name) &&
        name.trim() === name &&
        !name.includes("/") &&
        validGrants(grants, groupNames) &&
        validNotes(notes, writers(Array.isArray(grants) ? grants : [], groups))
      );
    }) &&
    (!Array.isArray(folders) ||
      distinct(folders.map(({ name }: { name?: unknown }) => name)))
  );
}
