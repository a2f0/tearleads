import {
  type ExportedKeyPackage,
  MultiUserDevice,
  type MultiUserDeviceServices,
} from "./multiUserDevice";

export interface ProbeActor {
  readonly name: string;
  readonly userId: string;
  readonly keyPackage: ExportedKeyPackage;
  readonly devices: MultiUserDevice[];
}

export interface ProbeGroup {
  readonly id: string;
  readonly name: string;
}

export interface ProbeDocument {
  readonly documentId: string;
  readonly containerIds: string[];
}

function primary(actor: ProbeActor): MultiUserDevice {
  const device = actor.devices[0];
  if (!device) throw new Error(`${actor.name} has no device.`);
  return device;
}

async function settleOrgMutation(device: MultiUserDevice): Promise<void> {
  await device.idle();
  await device.sdk.organizations.loadDirectoryAndGroupsAfterMutation();
}

async function admit(
  device: MultiUserDevice,
  member: ProbeActor,
): Promise<void> {
  const link = await primary(member).sdk.userIdentities.createLink(
    "https://app.example.test",
  );
  await device.sdk.userIdentities.verifyLink(link);
}

/**
 * Multi-user SDK coordinator for in-process performance probes, using only
 * public `@tearleads/client-sdk` facades over real local SQLite and HTTP.
 */
export class MultiUserWorld {
  private readonly actors: ProbeActor[] = [];
  private readonly workingOrganizations = new Map<string, string>();

  constructor(
    private readonly apiBaseUrl: string,
    private readonly identityTrustDomain: string,
    private readonly deviceServices: MultiUserDeviceServices = {},
  ) {}

  async register(name: string): Promise<ProbeActor> {
    const { device, keyPackage } = await MultiUserDevice.register(
      this.apiBaseUrl,
      this.identityTrustDomain,
      name,
      this.deviceServices,
    );
    const actor: ProbeActor = {
      name,
      userId: device.userId,
      keyPackage,
      devices: [device],
    };
    this.actors.push(actor);
    return actor;
  }

  async newDevice(actor: ProbeActor): Promise<MultiUserDevice> {
    const label = `${actor.name}-device-${actor.devices.length + 1}`;
    const device = await MultiUserDevice.login(
      this.apiBaseUrl,
      this.identityTrustDomain,
      label,
      actor.keyPackage,
      this.deviceServices,
    );
    const organizationId = this.workingOrganizations.get(actor.userId);
    if (organizationId) device.enterOrganization(organizationId);
    actor.devices.push(device);
    return device;
  }

  rootId(actor: ProbeActor): string {
    return primary(actor).rootContainerId;
  }

  primaryDevice(actor: ProbeActor): MultiUserDevice {
    return primary(actor);
  }

  async addToOrganization(
    owner: ProbeActor,
    member: ProbeActor,
    device = primary(owner),
  ): Promise<void> {
    const directory = await device.sdk.organizations.loadDirectoryAndGroups();
    if (!directory) throw new Error(`${owner.name} has no directory.`);
    await admit(device, member);
    await device.sdk.organizations.addUserToGroup({
      expectedGroupName: "Members",
      groupId: directory.memberGroupId,
      targetUserId: member.userId,
    });
    await settleOrgMutation(device);
    const organizationId = device.organizationId;
    this.workingOrganizations.set(member.userId, organizationId);
    for (const memberDevice of member.devices) {
      memberDevice.enterOrganization(organizationId);
    }
  }

  async adminsGroup(owner: ProbeActor): Promise<ProbeGroup> {
    const directory =
      await primary(owner).sdk.organizations.loadDirectoryAndGroups();
    const admins = directory?.groups.find(
      (group) => group.isBuiltin && group.name === "Admins",
    );
    if (!admins) throw new Error(`${owner.name} has no Admins group.`);
    return { id: admins.groupId, name: admins.name };
  }

  async createFolder(
    actor: ProbeActor,
    parentId: string,
    name: string,
  ): Promise<string> {
    const device = primary(actor);
    const created = await (await device.tree()).createChild(parentId, name);
    if (!created) throw new Error(`Could not create folder ${name}.`);
    await device.idle();
    return created.id;
  }

  async moveFolder(
    actor: ProbeActor,
    folderId: string,
    newParentId: string,
  ): Promise<void> {
    const device = primary(actor);
    const moved = await (await device.tree()).moveContainer(
      folderId,
      newParentId,
    );
    if (!moved) throw new Error(`Could not move folder ${folderId}.`);
    await device.idle();
  }

  async createDocument(
    actor: ProbeActor,
    folderId: string,
    text: string,
  ): Promise<ProbeDocument> {
    const device = primary(actor);
    const store = device.sdk.documents.open({
      containerId: folderId,
      localId: crypto.randomUUID(),
    });
    await store.setText(text);
    await device.idle();
    const documentId = store.getSnapshot().documentId;
    if (!documentId) throw new Error(`${actor.name}'s document has no id.`);
    return { documentId, containerIds: [folderId] };
  }

  async editDocument(
    actor: ProbeActor,
    document: ProbeDocument,
    text: string,
    device = primary(actor),
  ): Promise<void> {
    const store = await device.readDocument(
      document.documentId,
      document.containerIds,
    );
    if (!store) throw new Error(`${device.label} cannot open document.`);
    await store.setText(text);
    await device.idle();
    const pending = await device.sdk.containerContents
      .documentQueries()
      .listPendingWrites();
    if (pending.some((item) => item.remoteId === document.documentId)) {
      throw new Error(`${device.label}'s edit did not reach the API.`);
    }
  }

  private async heldSummary(device: MultiUserDevice, document: ProbeDocument) {
    const localId = await device.sdk.documents.findLocalIdByDocumentId(
      document.documentId,
    );
    const note = (await device.sdk.documents.list())?.rows.find(
      (row) => row.id === localId,
    );
    if (!note) {
      throw new Error(
        `${device.label} does not hold document ${document.documentId}.`,
      );
    }
    return note;
  }

  async linkDocument(
    actor: ProbeActor,
    document: ProbeDocument,
    folderId: string,
    device = primary(actor),
  ): Promise<void> {
    const note = await this.heldSummary(device, document);
    const linked = await device.sdk.containerContents
      .documentLinks()
      .linkDocumentToContainer({
        mergeDocumentSummary: () => undefined,
        note,
        setLinkedContainerIdsForDocument: () => undefined,
        targetContainerId: folderId,
      });
    if (!linked) {
      throw new Error(`Could not link document into ${folderId}.`);
    }
    await device.idle();
    if (!document.containerIds.includes(folderId)) {
      document.containerIds.push(folderId);
    }
  }

  async unlinkDocument(
    actor: ProbeActor,
    document: ProbeDocument,
    folderId: string,
    device = primary(actor),
  ): Promise<void> {
    const note = await this.heldSummary(device, document);
    const unlinked = await device.sdk.containerContents
      .documentLinks()
      .unlinkDocumentFromContainer({
        mergeDocumentSummary: () => undefined,
        note,
        removedContainerId: folderId,
        setLinkedContainerIdsForDocument: () => undefined,
      });
    if (!unlinked) {
      throw new Error(`Could not unlink document from ${folderId}.`);
    }
    await device.idle();
    const idx = document.containerIds.indexOf(folderId);
    if (idx >= 0) document.containerIds.splice(idx, 1);
  }

  async createGroup(actor: ProbeActor, name: string): Promise<ProbeGroup> {
    const device = primary(actor);
    const group = await device.sdk.organizations.createGroup(name);
    await settleOrgMutation(device);
    return { id: group.groupId, name };
  }

  async addToGroup(
    actor: ProbeActor,
    group: ProbeGroup,
    member: ProbeActor,
    device = primary(actor),
  ): Promise<void> {
    await admit(device, member);
    await device.sdk.organizations.addUserToGroup({
      expectedGroupName: group.name,
      groupId: group.id,
      targetUserId: member.userId,
    });
    await settleOrgMutation(device);
  }

  async removeFromGroup(
    actor: ProbeActor,
    group: ProbeGroup,
    member: ProbeActor,
    device = primary(actor),
  ): Promise<void> {
    await device.sdk.organizations.removeUserFromGroup({
      expectedGroupName: group.name,
      groupId: group.id,
      removedUserId: member.userId,
    });
    await settleOrgMutation(device);
  }

  async shareWithGroup(
    actor: ProbeActor,
    folderId: string,
    group: ProbeGroup,
    level: "read" | "write" | "admin",
    device = primary(actor),
  ): Promise<void> {
    await device.holdFolder(folderId);
    const shared = await (await device.tree()).shareWithGroup(
      folderId,
      group.id,
      level,
      { expectedGroupName: group.name },
    );
    if (!shared) throw new Error(`Could not share with ${group.name}.`);
    await device.idle();
  }

  async shareWithUser(
    actor: ProbeActor,
    folderId: string,
    recipient: ProbeActor,
    level: "read" | "write" | "admin" = "write",
    options: {
      readonly device?: MultiUserDevice;
      readonly skipLinkAdmit?: boolean;
    } = {},
  ): Promise<void> {
    const device = options.device ?? primary(actor);
    if (!options.skipLinkAdmit) await admit(device, recipient);
    const shared = await (await device.tree()).shareWithUser(
      folderId,
      recipient.userId,
      level,
    );
    if (!shared)
      throw new Error(`Could not share folder with ${recipient.name}.`);
    await device.idle();
  }

  async revokeGrant(
    actor: ProbeActor,
    folderId: string,
    subject: { readonly kind: "user" | "group"; readonly id: string },
    device = primary(actor),
  ): Promise<void> {
    await device.sdk.organizations.revokeGrant({
      containerId: folderId,
      subjectId: subject.id,
      subjectType: subject.kind,
    });
    await settleOrgMutation(device);
  }

  async keyEpoch(actor: ProbeActor, folderId: string): Promise<number> {
    const { containerContents } = primary(actor).sdk;
    containerContents
      .workflowRuntime()
      .apiClient.evictContainerWriterProjection(folderId);
    const info = await containerContents.loadContainerInfo({
      containerId: folderId,
      remoteInfoMode: "always",
    });
    const epoch = info.remoteInfo?.security?.currentContainerKeyEpoch;
    if (epoch === undefined) {
      throw new Error(`No key epoch for container ${folderId}.`);
    }
    return epoch;
  }

  dispose(): void {
    for (const actor of this.actors) {
      for (const device of actor.devices) device.dispose();
    }
  }
}
