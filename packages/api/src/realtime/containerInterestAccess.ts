export type AuthorizeContainerAccess = (
  userId: string,
  containerIds: string[],
) => Promise<string[]>;

export const authorizeContainerAccessWithWorkflow: AuthorizeContainerAccess =
  async (userId, containerIds) => {
    const [runtimeModule, accessModule] = await Promise.all([
      import("../services/runtime"),
      import("../workflows/keyingReadAccess"),
    ]);
    return runtimeModule
      .getDefaultApiServiceRuntime()
      .db.transaction(async (executor) => {
        const results = await accessModule.resolveReadableContainerAccessBatch({
          containerIds,
          executor,
          userId,
        });
        return containerIds.filter(
          (id) => results.get(id)?.status === "fulfilled",
        );
      });
  };
