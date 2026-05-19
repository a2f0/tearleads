import type { EncapsulationKeyResponse } from "@tearleads/validators/response";
import type { ContactEntry } from "../../data/contacts/addressBookEntry";

interface ContactKeyApi {
  getEncapsulationKey(userId: string): Promise<EncapsulationKeyResponse | null>;
}

interface ContactKeyLookupRuntime {
  apiClient: ContactKeyApi;
  log: (message: string) => void;
  userId?: string | null;
}

export async function fetchContactKeyEntryFromRuntime(input: {
  runtime: ContactKeyLookupRuntime;
  userId: string;
}): Promise<ContactEntry | null> {
  const { runtime, userId } = input;
  runtime.log(`Importing peer key for userId: ${userId}`);

  const response = await runtime.apiClient.getEncapsulationKey(userId);
  if (!response) {
    return null;
  }

  return {
    id: response.userId,
    firstName: "",
    lastName: "",
    userId: response.userId,
    encapsulationPublicKey: response.encapsulationPublicKey,
    isSelf: response.userId === runtime.userId,
  };
}
