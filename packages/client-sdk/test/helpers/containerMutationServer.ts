import { createMockRequestFailure } from "@tearleads/test-utils";
import type {
  ContainerMutationRequest,
  ContainerRotationRequest,
} from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createMutationResponseFromRequest } from "./containerFixtures";

type Manifest = ContainerWriterProjectionResponse["path"][number];
type Kek = ContainerWriterProjectionResponse["containerKeks"][number];

/**
 * The slice of the API a carried rotation touches. `requiredBelow` plays the
 * server's rule: a rotation of that container commits only with those
 * descendants' rekeys carried, and is otherwise refused whole.
 */
export function createContainerServer(
  projections: readonly ContainerWriterProjectionResponse[],
  requiredBelow: Readonly<Record<string, readonly string[]>> = {},
) {
  const nodes = new Map<
    string,
    {
      kek: Kek;
      manifest: Manifest;
      parentId: string | null;
      template: ContainerWriterProjectionResponse;
    }
  >();
  for (const template of projections) {
    const manifest = template.path.at(-1);
    const kek = template.containerKeks.at(-1);
    if (!manifest || !kek) throw new Error("Expected a complete projection");
    nodes.set(template.containerId, {
      kek,
      manifest,
      parentId: template.containerKeks.at(-2)?.containerId ?? null,
      template,
    });
  }
  const submissions: string[][] = [];
  const project = (containerId: string) => {
    const target = nodes.get(containerId);
    if (!target) return null;
    const path: Manifest[] = [];
    const containerKeks: Kek[] = [];
    for (
      let node = nodes.get(containerId);
      node;
      node = node.parentId === null ? undefined : nodes.get(node.parentId)
    ) {
      path.unshift(node.manifest);
      containerKeks.unshift(node.kek);
    }
    return { ...target.template, containerKeks, path };
  };
  const apply = async (
    containerId: string,
    request: ContainerMutationRequest,
  ) => {
    const node = nodes.get(containerId);
    if (!node) throw new Error(`Unknown container ${containerId}`);
    const response = await createMutationResponseFromRequest(request, node.kek);
    nodes.set(containerId, {
      ...node,
      kek: {
        ...response.containerKek,
        containerManifestHistory: [
          node.manifest,
          ...node.kek.containerManifestHistory,
        ],
      },
      manifest: response.accessManifest,
    });
    return response;
  };
  const rekeyContainerResult = async (
    containerId: string,
    request: ContainerRotationRequest,
  ) => {
    const { containerRekeys = [], ...rotation } = request;
    const carriedIds = containerRekeys.map((carried) =>
      String(Reflect.get(carried.event, "objectId")),
    );
    submissions.push([containerId, ...carriedIds]);
    const required = requiredBelow[containerId] ?? [];
    if (required.some((requiredId) => !carriedIds.includes(requiredId))) {
      return createMockRequestFailure({
        code: "container_descendant_rekeys_required",
        message: "Container rotation must carry its descendant rekeys",
        requiredContainerIds: required,
        status: 409,
      });
    }
    const response = await apply(containerId, rotation);
    const carriedResponses = [];
    for (const [index, carried] of containerRekeys.entries()) {
      carriedResponses.push(await apply(carriedIds[index] ?? "", carried));
    }
    return {
      data: { ...response, containerRekeys: carriedResponses },
      ok: true as const,
    };
  };
  return {
    apiClient: {
      getContainerWriterProjection: async (containerId: string) =>
        project(containerId),
      reciteContainer: async () => null,
      rekeyContainer: async (
        containerId: string,
        request: ContainerRotationRequest,
      ) => {
        const result = await rekeyContainerResult(containerId, request);
        return result.ok ? result.data : null;
      },
      rekeyContainerResult,
      shareContainer: async (
        containerId: string,
        request: ContainerMutationRequest,
      ) => {
        submissions.push([`share:${containerId}`]);
        return apply(containerId, request);
      },
    },
    project,
    submissions,
  };
}
