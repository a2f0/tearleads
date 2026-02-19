import type { QueueVfsCrdtLocalOperationInput } from '@tearleads/vfs-sync/vfs';
import type { VfsBlobStageRequest } from './vfsBlobNetworkFlusher';

export interface VfsSecureWritePipeline {
  prepareCrdtLocalOperation(
    input: QueueVfsCrdtLocalOperationInput
  ): Promise<QueueVfsCrdtLocalOperationInput>;
  prepareBlobStage(input: VfsBlobStageRequest): Promise<VfsBlobStageRequest>;
}

export class PassthroughVfsSecureWritePipeline
  implements VfsSecureWritePipeline
{
  async prepareCrdtLocalOperation(
    input: QueueVfsCrdtLocalOperationInput
  ): Promise<QueueVfsCrdtLocalOperationInput> {
    return input;
  }

  async prepareBlobStage(
    input: VfsBlobStageRequest
  ): Promise<VfsBlobStageRequest> {
    return input;
  }
}
