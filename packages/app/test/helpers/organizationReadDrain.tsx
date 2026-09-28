import { useEffect } from "react";
import { useTearleads } from "../../src/providers/sdk/TearleadsProvider";

/** Keep real policy loads alive through test teardown, including time in SQLite
 * and signature verification between HTTP requests. Network quiet alone cannot
 * prove that a presentation load has finished. */
export function createOrganizationReadDrain() {
  const pending = new Set<Promise<unknown>>();

  function track<Result>(operation: Promise<Result>): Promise<Result> {
    const tracked = operation.finally(() => pending.delete(tracked));
    pending.add(tracked);
    return tracked;
  }

  function OrganizationReadDrainProbe() {
    const { organizations } = useTearleads();
    useEffect(() => {
      const loadGroup = organizations.loadGroupPresentationDetails;
      const loadOrganization = organizations.loadPolicyHistory;
      organizations.loadGroupPresentationDetails = (groupId) =>
        track(loadGroup.call(organizations, groupId));
      organizations.loadPolicyHistory = () =>
        track(loadOrganization.call(organizations));
      return () => {
        organizations.loadGroupPresentationDetails = loadGroup;
        organizations.loadPolicyHistory = loadOrganization;
      };
    }, [organizations]);
    return null;
  }

  async function drain(): Promise<void> {
    while (pending.size > 0) {
      await Promise.allSettled([...pending]);
    }
  }

  return { drain, Probe: OrganizationReadDrainProbe };
}
