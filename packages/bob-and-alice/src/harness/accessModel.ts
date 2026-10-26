/**
 * A deliberately naive reference for who may read and write what. Scenarios
 * apply every operation here and to the real system, then compare: the model
 * walks plain parent pointers and set memberships, so it knows nothing about
 * manifests, key epochs, or wraps, which is what makes it an independent
 * oracle for them.
 */

export type AccessLevel = "admin" | "read" | "write";

export type GrantSubject =
  | { readonly kind: "user"; readonly id: string }
  | { readonly kind: "group"; readonly id: string };

interface ModelContainer {
  parentId: string | null;
  readonly grants: Map<string, { subject: GrantSubject; level: AccessLevel }>;
}

interface ModelDocument {
  readonly containerIds: Set<string>;
  /** Every text the document has held, oldest first. */
  readonly versions: { text: string; readers: ReadonlySet<string> }[];
}

const LEVEL_RANK: Record<AccessLevel, number> = { read: 1, write: 2, admin: 3 };

function subjectKey(subject: GrantSubject): string {
  return `${subject.kind}:${subject.id}`;
}

export class AccessModel {
  private readonly containers = new Map<string, ModelContainer>();
  private readonly documents = new Map<string, ModelDocument>();
  private readonly groups = new Map<string, Set<string>>();
  private readonly users = new Set<string>();

  addUser(userId: string): void {
    this.users.add(userId);
  }

  addContainer(input: {
    containerId: string;
    parentId: string | null;
    owner?: string | undefined;
  }): void {
    const container: ModelContainer = {
      parentId: input.parentId,
      grants: new Map(),
    };
    this.containers.set(input.containerId, container);
    if (input.owner) {
      this.grant(input.containerId, { kind: "user", id: input.owner }, "admin");
    }
  }

  moveContainer(containerId: string, parentId: string): void {
    this.requireContainer(containerId).parentId = parentId;
  }

  grant(containerId: string, subject: GrantSubject, level: AccessLevel): void {
    this.requireContainer(containerId).grants.set(subjectKey(subject), {
      subject,
      level,
    });
  }

  revoke(containerId: string, subject: GrantSubject): void {
    this.requireContainer(containerId).grants.delete(subjectKey(subject));
  }

  addGroup(groupId: string, members: readonly string[]): void {
    this.groups.set(groupId, new Set(members));
  }

  addGroupMember(groupId: string, userId: string): void {
    this.requireGroup(groupId).add(userId);
  }

  removeGroupMember(groupId: string, userId: string): void {
    this.requireGroup(groupId).delete(userId);
  }

  addDocument(documentId: string, containerId: string, text: string): void {
    this.documents.set(documentId, {
      containerIds: new Set([containerId]),
      versions: [],
    });
    this.recordVersion(documentId, text);
  }

  /** Applies an edit if the author may write; returns whether it applied. */
  edit(documentId: string, author: string, text: string): boolean {
    if (!this.canWrite(author, documentId)) {
      return false;
    }
    this.recordVersion(documentId, text);
    return true;
  }

  /** The highest level `userId` holds on `containerId`, through any path. */
  containerLevel(userId: string, containerId: string): AccessLevel | null {
    let best: AccessLevel | null = null;
    const seen = new Set<string>();
    let current: string | null = containerId;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      const container = this.requireContainer(current);
      for (const { subject, level } of container.grants.values()) {
        if (!this.subjectIncludes(subject, userId)) continue;
        if (best === null || LEVEL_RANK[level] > LEVEL_RANK[best]) {
          best = level;
        }
      }
      current = container.parentId;
    }
    return best;
  }

  documentLevel(userId: string, documentId: string): AccessLevel | null {
    let best: AccessLevel | null = null;
    for (const containerId of this.requireDocument(documentId).containerIds) {
      const level = this.containerLevel(userId, containerId);
      if (level && (best === null || LEVEL_RANK[level] > LEVEL_RANK[best])) {
        best = level;
      }
    }
    return best;
  }

  canRead(userId: string, documentId: string): boolean {
    return this.documentLevel(userId, documentId) !== null;
  }

  canWrite(userId: string, documentId: string): boolean {
    const level = this.documentLevel(userId, documentId);
    return level !== null && LEVEL_RANK[level] >= LEVEL_RANK.write;
  }

  latestText(documentId: string): string {
    const latest = this.requireDocument(documentId).versions.at(-1);
    if (!latest) throw new Error(`Document ${documentId} has no versions`);
    return latest.text;
  }

  /**
   * Texts a device of `userId` may still hold without current access:
   * revocation is forward-only, so whatever it could read before stays
   * possible, and nothing written after it lost access is.
   */
  textsVisibleWithoutAccess(userId: string, documentId: string): string[] {
    return this.requireDocument(documentId)
      .versions.filter((version) => version.readers.has(userId))
      .map((version) => version.text);
  }

  private recordVersion(documentId: string, text: string): void {
    const readers = new Set(
      [...this.users].filter((userId) => this.canRead(userId, documentId)),
    );
    this.requireDocument(documentId).versions.push({ text, readers });
  }

  private subjectIncludes(subject: GrantSubject, userId: string): boolean {
    return subject.kind === "user"
      ? subject.id === userId
      : this.requireGroup(subject.id).has(userId);
  }

  private requireContainer(containerId: string): ModelContainer {
    const container = this.containers.get(containerId);
    if (!container) throw new Error(`Unknown container ${containerId}`);
    return container;
  }

  private requireDocument(documentId: string): ModelDocument {
    const document = this.documents.get(documentId);
    if (!document) throw new Error(`Unknown document ${documentId}`);
    return document;
  }

  private requireGroup(groupId: string): Set<string> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error(`Unknown group ${groupId}`);
    return group;
  }
}
