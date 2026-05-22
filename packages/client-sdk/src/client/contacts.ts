import {
  type ContactsWorkflowRuntime,
  createContactsWorkflowRuntime,
} from "../workflows/contacts";
import type { TearleadsInternalRuntime } from "./workflowRuntime";

export interface TearleadsContacts {
  runtime(): ContactsWorkflowRuntime;
}

export function createTearleadsContacts(
  runtime: TearleadsInternalRuntime,
): TearleadsContacts {
  return new TearleadsContactsService(runtime);
}

class TearleadsContactsService implements TearleadsContacts {
  constructor(private readonly runtimeService: TearleadsInternalRuntime) {}

  runtime(): ContactsWorkflowRuntime {
    return createContactsWorkflowRuntime(this.runtimeService.workflowInput());
  }
}
