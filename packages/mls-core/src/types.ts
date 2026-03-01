/** Local MLS state stored in IndexedDB. */
export interface LocalMlsState {
  groupId: string;
  serializedState: Uint8Array;
  epoch: number;
  updatedAt: number;
}

/** MLS credential stored locally. */
export interface MlsCredential {
  credentialBundle: Uint8Array;
  privateKey: Uint8Array;
  userId: string;
  createdAt: number;
}

/** Unused key package with private key. */
export interface LocalKeyPackage {
  ref: string;
  keyPackage: Uint8Array;
  privateKey: Uint8Array;
  createdAt: number;
}
