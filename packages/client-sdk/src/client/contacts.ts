import {
  type ContactsWorkflowRuntime,
  createContactsWorkflowRuntime,
} from "../workflows/contacts";
import type { TearleadsWorkflowRuntimeInput } from "./workflowRuntime";

interface TearleadsContactsDependencies {
  createWorkflowRuntimeInput: () => TearleadsWorkflowRuntimeInput;
}

export class TearleadsContacts {
  constructor(private readonly dependencies: TearleadsContactsDependencies) {}

  runtime(): ContactsWorkflowRuntime {
    return createContactsWorkflowRuntime(
      this.dependencies.createWorkflowRuntimeInput(),
    );
  }
}
