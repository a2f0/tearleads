type PublishEvent = (event: Record<string, unknown>) => Promise<void>;

/**
 * Publishes a realtime event for a mutation that has already committed.
 * Realtime is a lossy hint — HTTP reconciliation stays authoritative — so a
 * broker outage logs instead of turning the committed write into a misleading
 * failure response.
 */
export async function publishBestEffort(
  publish: PublishEvent,
  event: Record<string, unknown>,
  label: string,
): Promise<void> {
  try {
    await publish(event);
  } catch (error) {
    console.error(`Failed to publish ${label}:`, error);
  }
}
