import {
  type AuthorizeContainerAccess,
  principalInterestKey,
} from "./containerInterestTypes";

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
        return containerIds.flatMap((containerId) => {
          const result = results.get(containerId);
          if (result?.status !== "fulfilled") return [];
          return [
            {
              containerId,
              principalKeys: result.value.principalPolicies
                .filter((policy) => policy.principalType === "group")
                .map(principalInterestKey),
              pathContainerIds: result.value.verifiedPath.map(
                (manifest) => manifest.state.containerId,
              ),
            },
          ];
        });
      });
  };
