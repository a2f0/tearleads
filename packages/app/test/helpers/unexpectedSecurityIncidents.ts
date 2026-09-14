import type { SecurityIncidents } from "@tearleads/client-sdk";

/** Restore ledger stub for tests whose backups carry no equivocation evidence. */
export const unexpectedSecurityIncidents: Pick<SecurityIncidents, "record"> = {
  async record(error) {
    throw new Error("Unexpected security incident", { cause: error });
  },
};
