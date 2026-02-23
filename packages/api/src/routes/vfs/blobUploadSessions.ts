interface UploadedChunk {
  chunkIndex: number;
  isFinal: boolean;
  ciphertextBase64: string;
  plaintextLength: number;
  ciphertextLength: number;
}

interface UploadSession {
  chunksByIndex: Map<number, UploadedChunk>;
}

const sessionsByStagingId = new Map<string, Map<string, UploadSession>>();

function getOrCreateStagingSessions(stagingId: string): Map<string, UploadSession> {
  const existing = sessionsByStagingId.get(stagingId);
  if (existing) {
    return existing;
  }
  const created = new Map<string, UploadSession>();
  sessionsByStagingId.set(stagingId, created);
  return created;
}

function getOrCreateUploadSession(
  stagingId: string,
  uploadId: string
): UploadSession {
  const stagingSessions = getOrCreateStagingSessions(stagingId);
  const existing = stagingSessions.get(uploadId);
  if (existing) {
    return existing;
  }

  const created: UploadSession = {
    chunksByIndex: new Map<number, UploadedChunk>()
  };
  stagingSessions.set(uploadId, created);
  return created;
}

export function upsertBlobUploadChunk(input: {
  stagingId: string;
  uploadId: string;
  chunk: UploadedChunk;
}): void {
  const session = getOrCreateUploadSession(input.stagingId, input.uploadId);
  session.chunksByIndex.set(input.chunk.chunkIndex, input.chunk);
}

export function getBlobUploadChunks(input: {
  stagingId: string;
  uploadId: string;
}): UploadedChunk[] | null {
  const stagingSessions = sessionsByStagingId.get(input.stagingId);
  const session = stagingSessions?.get(input.uploadId);
  if (!session) {
    return null;
  }

  return Array.from(session.chunksByIndex.values()).sort(
    (left, right) => left.chunkIndex - right.chunkIndex
  );
}

export function deleteBlobUploadSession(input: {
  stagingId: string;
  uploadId: string;
}): void {
  const stagingSessions = sessionsByStagingId.get(input.stagingId);
  if (!stagingSessions) {
    return;
  }

  stagingSessions.delete(input.uploadId);
  if (stagingSessions.size === 0) {
    sessionsByStagingId.delete(input.stagingId);
  }
}

export function clearBlobUploadSessions(): void {
  sessionsByStagingId.clear();
}
