/** Match production's single resync frame per socket and changed dependency. */
export function evictMswContainerInterests<Client>(input: {
  ancestorId: string;
  interests: Map<Client, Set<string>>;
  containerPath: ((id: string) => readonly string[] | null) | undefined;
  send: (client: Client, event: Record<string, unknown>) => void;
}): void {
  for (const [client, interest] of input.interests) {
    const containerIds = [...interest].filter((id) => {
      const path = input.containerPath?.(id) ?? [id];
      return id === input.ancestorId || path.includes(input.ancestorId);
    });
    for (const id of containerIds) interest.delete(id);
    if (containerIds.length)
      input.send(client, { containerIds, type: "resync_required" });
  }
}
