import {
  type ContactsWorkflowRuntime,
  createContactsWorkflowRuntime,
} from "../workflows/contacts";
import type { TearleadsRuntime } from "./workflowRuntime";

export interface TearleadsContacts {
  runtime(): ContactsWorkflowRuntime;
}

export function createTearleadsContacts(
  runtime: TearleadsRuntime,
): TearleadsContacts {
  return new TearleadsContactsService(runtime);
}

class TearleadsContactsService implements TearleadsContacts {
  constructor(private readonly runtimeService: TearleadsRuntime) {}

  runtime(): ContactsWorkflowRuntime {
    return createContactsWorkflowRuntime(this.runtimeService.input());
  }
}
