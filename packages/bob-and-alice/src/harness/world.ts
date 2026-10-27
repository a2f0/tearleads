import {
  type AccessLevel,
  AccessModel,
  type GrantSubject,
} from "./accessModel";
import { startApiServer } from "./apiServer";
import { Device, type DeviceKeys } from "./device";
import { readDocument } from "./documentReads";
import { trace } from "./trace";

export interface User {
  readonly name: string;
  readonly userId: string;
  readonly keys: DeviceKeys;
  /** Every install of this identity, first-registered first. */
  readonly devices: Device[];
}

export interface Folder {
  readonly id: string;
  readonly name: string;
}

export interface Group {
  readonly id: string;
  readonly name: string;
}

export interface SharedDocument {
  readonly documentId: string;
  /** The folder it was created in; links add others in the model. */
  readonly containerId: string;
}

/** Org mutations refresh the verified directory, as the org manager does. */
async function settleOrganizationMutation(device: Device): Promise<void> {
  await device.idle();
  await device.sdk.organizations.loadDirectoryAndGroupsAfterMutation();
}

async function heldSummary(device: Device, document: SharedDocument) {
  const localId = await device.sdk.documents.findLocalIdByDocumentId(
    document.documentId,
  );
  const note = (await device.sdk.documents.list())?.rows.find(
    (row) => row.id === localId,
  );
  if (!note) throw new Error(`${device.label} does not hold the document`);
  return note;
}

function primary(user: User): Device {
  const device = user.devices[0];
  if (!device) throw new Error(`${user.name} has no device`);
  return device;
}

/**
 * Users, their devices, and the reference model, driven together. Each
 * operation runs through a real device first and is mirrored into the model
 * only once the device reports it settled, so `expectAccess` compares the
 * system against what was actually committed.
 */
export class World {
  readonly model = new AccessModel();
  private readonly users: User[] = [];
  /** The organization each joined member works in, by user id. */
  private readonly workingOrganizations = new Map<string, string>();
  /** Texts each device tried to write without write access. */
  private readonly refusedEdits = new Map<Device, Map<string, Set<string>>>();

  private constructor(private readonly origin: string) {}

  static async create(): Promise<World> {
    return new World(await startApiServer());
  }

  async register(name: string): Promise<User> {
    const { device, keys } = await Device.register(this.origin, name);
    const user: User = { name, userId: device.userId, keys, devices: [device] };
    this.users.push(user);
    this.model.addUser(user.userId);
    this.model.addContainer({
      containerId: device.rootContainerId,
      owner: user.userId,
      parentId: null,
    });
    return user;
  }

  /** A fresh install of `user` with an empty local database. */
  async newDevice(user: User): Promise<Device> {
    const label = `${user.name}-device-${user.devices.length + 1}`;
    const device = await Device.login(this.origin, label, user.keys);
    const organizationId = this.workingOrganizations.get(user.userId);
    if (organizationId) device.enterOrganization(organizationId);
    user.devices.push(device);
    return device;
  }

  root(user: User): Folder {
    return { id: primary(user).rootContainerId, name: `${user.name} root` };
  }

  /**
   * Adds `member` to `owner`'s organization roster (its Members group) and
   * has every device of `member` work inside that organization from now on.
   */
  async addToOrganization(owner: User, member: User): Promise<void> {
    trace(`addToOrganization`);
    const directory =
      await primary(owner).sdk.organizations.loadDirectoryAndGroups();
    if (!directory) throw new Error(`${owner.name} has no directory`);
    await primary(owner).sdk.organizations.addUserToGroup({
      expectedGroupName: "Members",
      groupId: directory.memberGroupId,
      targetUserId: member.userId,
    });
    await settleOrganizationMutation(primary(owner));
    const organizationId = primary(owner).organizationId;
    this.workingOrganizations.set(member.userId, organizationId);
    for (const device of member.devices)
      device.enterOrganization(organizationId);
  }

  async createFolder(
    actor: User,
    parent: Folder,
    name: string,
  ): Promise<Folder> {
    trace(`createFolder`);
    const device = primary(actor);
    const created = await (await device.tree()).createChild(parent.id, name);
    if (!created) throw device.failure(`could not create ${name}`);
    await device.idle();
    this.model.addContainer({ containerId: created.id, parentId: parent.id });
    return { id: created.id, name };
  }

  async moveFolder(actor: User, folder: Folder, parent: Folder): Promise<void> {
    trace(`moveFolder`);
    const device = primary(actor);
    const moved = await (await device.tree()).moveContainer(
      folder.id,
      parent.id,
    );
    if (!moved) throw device.failure(`could not move ${folder.name}`);
    await device.idle();
    this.model.moveContainer(folder.id, parent.id);
  }

  async createDocument(
    actor: User,
    folder: Folder,
    text: string,
  ): Promise<SharedDocument> {
    trace(`createDocument`);
    const device = primary(actor);
    const store = device.sdk.documents.open({
      containerId: folder.id,
      localId: crypto.randomUUID(),
    });
    await store.setText(text);
    await device.idle();
    const documentId = store.getSnapshot().documentId;
    if (!documentId) throw new Error(`${actor.name}'s document has no id`);
    this.model.addDocument(documentId, folder.id, text);
    return { documentId, containerId: folder.id };
  }

  /**
   * Edits from `device` (the actor's first device by default). An edit the
   * actor may make must apply locally and settle with nothing left pending.
   * A successful write clears prior refused edits for this document; reads on
   * other devices verify the committed text. A refused edit may stay parked;
   * the model ignores it, so an accepted refused edit appears as a mismatch
   * in `expectAccess`.
   */
  async editDocument(
    actor: User,
    document: SharedDocument,
    text: string,
    device: Device = primary(actor),
  ): Promise<void> {
    trace(`editDocument`);
    const store = await readDocument(device, this.documentRef(document));
    if (!store) throw device.failure("cannot open the document");
    await store.setText(text);
    if (!this.model.edit(document.documentId, actor.userId, text)) {
      const documents =
        this.refusedEdits.get(device) ?? new Map<string, Set<string>>();
      const refused = documents.get(document.documentId) ?? new Set<string>();
      refused.add(text);
      documents.set(document.documentId, refused);
      this.refusedEdits.set(device, documents);
      await device.idle().catch(() => undefined);
      return;
    }
    await device.idle();
    if (store.getSnapshot().text !== text) {
      throw device.failure("edit was not applied locally");
    }
    const pending = await device.sdk.containerContents
      .documentQueries()
      .listPendingWrites();
    if (pending.some((item) => item.remoteId === document.documentId)) {
      throw device.failure("edit did not reach the API");
    }
    this.refusedEdits.get(device)?.delete(document.documentId);
  }

  /** The document with every container it is currently linked into. */
  documentRef(document: SharedDocument) {
    return {
      documentId: document.documentId,
      containerIds: this.model.documentContainers(document.documentId),
    };
  }

  async linkDocument(actor: User, document: SharedDocument, folder: Folder) {
    trace(`linkDocument`);
    const device = primary(actor);
    const note = await heldSummary(device, document);
    const linked = await device.sdk.containerContents
      .documentLinks()
      .linkDocumentToContainer({
        mergeDocumentSummary: () => undefined,
        note,
        setLinkedContainerIdsForDocument: () => undefined,
        targetContainerId: folder.id,
      });
    if (!linked) throw device.failure(`could not link into ${folder.name}`);
    await device.idle();
    this.model.linkDocument(document.documentId, folder.id);
  }

  async unlinkDocument(actor: User, document: SharedDocument, folder: Folder) {
    trace(`unlinkDocument`);
    const device = primary(actor);
    const note = await heldSummary(device, document);
    const unlinked = await device.sdk.containerContents
      .documentLinks()
      .unlinkDocumentFromContainer({
        mergeDocumentSummary: () => undefined,
        note,
        removedContainerId: folder.id,
        setLinkedContainerIdsForDocument: () => undefined,
      });
    if (!unlinked) throw device.failure(`could not unlink ${folder.name}`);
    await device.idle();
    this.model.unlinkDocument(document.documentId, folder.id);
  }

  async shareWithUser(actor: User, folder: Folder, recipient: User) {
    trace(`shareWithUser`);
    const device = primary(actor);
    const shared = await (await device.tree()).shareWithUser(
      folder.id,
      recipient.userId,
    );
    if (!shared) throw device.failure(`could not share ${folder.name}`);
    await device.idle();
    // The product's direct user share always grants write.
    this.model.grant(
      folder.id,
      { kind: "user", id: recipient.userId },
      "write",
    );
  }

  async createGroup(actor: User, name: string): Promise<Group> {
    trace(`createGroup`);
    const device = primary(actor);
    const group = await device.sdk.organizations.createGroup(name);
    await settleOrganizationMutation(device);
    this.model.addGroup(group.groupId, []);
    return { id: group.groupId, name };
  }

  async addToGroup(actor: User, group: Group, member: User): Promise<void> {
    trace(`addToGroup`);
    const device = primary(actor);
    await device.sdk.organizations.addUserToGroup({
      expectedGroupName: group.name,
      groupId: group.id,
      targetUserId: member.userId,
    });
    await settleOrganizationMutation(device);
    this.model.addGroupMember(group.id, member.userId);
  }

  async removeFromGroup(
    actor: User,
    group: Group,
    member: User,
    device: Device = primary(actor),
  ) {
    trace(`removeFromGroup`);
    await device.sdk.organizations.removeUserFromGroup({
      expectedGroupName: group.name,
      groupId: group.id,
      removedUserId: member.userId,
    });
    await settleOrganizationMutation(device);
    this.model.removeGroupMember(group.id, member.userId);
  }

  async shareWithGroup(
    actor: User,
    folder: Folder,
    group: Group,
    level: AccessLevel,
    device: Device = primary(actor),
  ): Promise<void> {
    trace(`shareWithGroup`);
    await device.holdFolder(folder.id);
    const shared = await (await device.tree()).shareWithGroup(
      folder.id,
      group.id,
      level,
      { expectedGroupName: group.name },
    );
    if (!shared) throw device.failure(`could not share with ${group.name}`);
    await device.idle();
    this.model.grant(folder.id, { kind: "group", id: group.id }, level);
  }

  async revoke(actor: User, folder: Folder, subject: User | Group) {
    trace(`revoke`);
    const device = primary(actor);
    const grant: GrantSubject =
      "userId" in subject
        ? { kind: "user", id: subject.userId }
        : { kind: "group", id: subject.id };
    await device.sdk.organizations.revokeGrant({
      containerId: folder.id,
      subjectId: grant.id,
      subjectType: grant.kind,
    });
    await settleOrganizationMutation(device);
    this.model.revoke(folder.id, grant);
  }

  /** The container's current key epoch, as `actor` verifies it. */
  async keyEpoch(actor: User, folder: Folder): Promise<number> {
    trace(`keyEpoch`);
    const { containerContents } = primary(actor).sdk;
    // Read what the API holds now: without realtime hints, nothing evicts a
    // projection this device cached before another device rotated the folder.
    containerContents
      .workflowRuntime()
      .apiClient.evictContainerWriterProjection(folder.id);
    const info = await containerContents.loadContainerInfo({
      containerId: folder.id,
      remoteInfoMode: "always",
    });
    const epoch = info.remoteInfo?.security?.currentContainerKeyEpoch;
    if (epoch === undefined) throw new Error(`No key epoch for ${folder.name}`);
    return epoch;
  }

  /** The document's current content-key epoch, as `actor` verifies it. */
  async contentKeyEpoch(
    actor: User,
    document: SharedDocument,
  ): Promise<number> {
    trace(`contentKeyEpoch`);
    const device = primary(actor);
    const localId = await device.sdk.documents.findLocalIdByDocumentId(
      document.documentId,
    );
    if (!localId) throw device.failure(`does not hold the document`);
    const info = await device.sdk.containerContents.loadDocumentInfo({
      localId,
      remoteInfoMode: "if-synced",
    });
    const epoch = info.remoteInfo?.contentKeyEpoch;
    if (epoch === undefined) throw new Error("No content-key epoch");
    return epoch;
  }

  /**
   * The folder key epochs the document's current content key is wrapped
   * to, as the API serves them to `actor`. Behind the folder's own epoch,
   * a reader needs the folder keyring to open the document at all.
   */
  async bundleKeyEpochs(
    actor: User,
    document: SharedDocument,
  ): Promise<number[]> {
    const projection = await primary(actor)
      .sdk.containerContents.workflowRuntime()
      .apiClient.getDocumentWriterProjection(document.documentId);
    if (!projection) throw new Error("No document writer projection");
    return projection.contentKeyBundle.targets.map(
      (target) => target.containerKeyEpoch,
    );
  }

  /**
   * Texts `device` tried to write without write access. A device that lost
   * access may still show its own refused edit; that discloses nothing.
   */
  refusedEditsOn(device: Device, documentId: string): ReadonlySet<string> {
    return this.refusedEdits.get(device)?.get(documentId) ?? new Set();
  }

  get allUsers(): readonly User[] {
    return this.users;
  }

  dispose(): void {
    for (const user of this.users) {
      for (const device of user.devices) device.dispose();
    }
  }
}
