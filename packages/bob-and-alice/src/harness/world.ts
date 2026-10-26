import {
  type AccessLevel,
  AccessModel,
  type GrantSubject,
} from "./accessModel";
import { startApiServer } from "./apiServer";
import { Device, type DeviceKeys } from "./device";
import { readDocument } from "./documentReads";

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
  readonly containerId: string;
}

/** Org mutations refresh the verified directory, as the org manager does. */
async function settleOrganizationMutation(device: Device): Promise<void> {
  await device.idle();
  await device.sdk.organizations.loadDirectoryAndGroupsAfterMutation();
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
    user.devices.push(device);
    return device;
  }

  root(user: User): Folder {
    return { id: primary(user).rootContainerId, name: `${user.name} root` };
  }

  /** Adds `member` to `owner`'s organization roster (its Members group). */
  async addToOrganization(owner: User, member: User): Promise<void> {
    const directory =
      await primary(owner).sdk.organizations.loadDirectoryAndGroups();
    if (!directory) throw new Error(`${owner.name} has no directory`);
    await primary(owner).sdk.organizations.addUserToGroup({
      expectedGroupName: "Members",
      groupId: directory.memberGroupId,
      targetUserId: member.userId,
    });
    await settleOrganizationMutation(primary(owner));
  }

  async createFolder(
    actor: User,
    parent: Folder,
    name: string,
  ): Promise<Folder> {
    const device = primary(actor);
    const created = await (await device.tree()).createChild(parent.id, name);
    if (!created) throw device.failure(`could not create ${name}`);
    await device.idle();
    this.model.addContainer({ containerId: created.id, parentId: parent.id });
    return { id: created.id, name };
  }

  async moveFolder(actor: User, folder: Folder, parent: Folder): Promise<void> {
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
   * actor may make must settle with nothing left pending, so a write that
   * only ever landed locally fails here rather than passing on optimistic
   * local text. A refused edit may stay parked; the model ignores it, so one
   * the system wrongly accepted shows up as a mismatch in `expectAccess`.
   */
  async editDocument(
    actor: User,
    document: SharedDocument,
    text: string,
    device: Device = primary(actor),
  ): Promise<void> {
    const store = await readDocument(device, document);
    if (!store) throw device.failure("cannot open the document");
    await store.setText(text);
    if (!this.model.edit(document.documentId, actor.userId, text)) {
      await device.idle().catch(() => undefined);
      return;
    }
    await device.idle();
    const pending = await device.sdk.containerContents
      .documentQueries()
      .listPendingWrites();
    if (pending.some((item) => item.remoteId === document.documentId)) {
      throw device.failure("edit did not reach the API");
    }
  }

  async shareWithUser(actor: User, folder: Folder, recipient: User) {
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
    const device = primary(actor);
    const group = await device.sdk.organizations.createGroup(name);
    await settleOrganizationMutation(device);
    this.model.addGroup(group.groupId, []);
    return { id: group.groupId, name };
  }

  async addToGroup(actor: User, group: Group, member: User): Promise<void> {
    const device = primary(actor);
    await device.sdk.organizations.addUserToGroup({
      expectedGroupName: group.name,
      groupId: group.id,
      targetUserId: member.userId,
    });
    await settleOrganizationMutation(device);
    this.model.addGroupMember(group.id, member.userId);
  }

  async removeFromGroup(actor: User, group: Group, member: User) {
    const device = primary(actor);
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
  ): Promise<void> {
    const device = primary(actor);
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
    const info = await primary(actor).sdk.containerContents.loadContainerInfo({
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

  get allUsers(): readonly User[] {
    return this.users;
  }

  dispose(): void {
    for (const user of this.users) {
      for (const device of user.devices) device.dispose();
    }
  }
}
