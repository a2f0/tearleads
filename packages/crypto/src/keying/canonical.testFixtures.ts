import { computeKeyingDomainHash } from "./index";

export async function fixtureHash(label: string): Promise<string> {
  return computeKeyingDomainHash("tearleads.keying.access-event-body", {
    fixture: label,
  });
}
