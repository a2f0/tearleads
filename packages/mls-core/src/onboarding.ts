/**
 * MLS onboarding: generate credentials + key packages during registration.
 *
 * This mirrors VFS key setup — key material is created client-side so that
 * MLS key packages are immediately available on the server for other users.
 */

import { MlsStorage } from './storage.js';
import {
  wasmGenerateCredential,
  wasmGenerateKeyPackage
} from './mlsWasmBridge.js';
import { resolveMlsBackendStatus } from './mlsWasmBackend.js';
import type { MlsCredential } from './types.js';

const DEFAULT_KEY_PACKAGE_COUNT = 5;

export interface OnboardingKeyPackage {
  keyPackageData: Uint8Array;
  keyPackageRef: string;
}

export interface OnboardingKeyMaterial {
  keyPackages: OnboardingKeyPackage[];
}

export async function generateMlsOnboardingKeyMaterial(
  userId: string,
  count = DEFAULT_KEY_PACKAGE_COUNT
): Promise<OnboardingKeyMaterial> {
  const status = await resolveMlsBackendStatus();
  if (!status.productionReady) {
    throw new Error(`MLS backend not ready: ${status.reason}`);
  }

  const storage = new MlsStorage();
  try {
    await storage.init();

    const existing = await storage.getCredential(userId);
    if (existing) {
      return { keyPackages: [] };
    }

    const result = await wasmGenerateCredential(userId);

    const credential: MlsCredential = {
      credentialBundle: result.credentialBundle,
      privateKey: result.privateKey,
      userId,
      createdAt: result.createdAtMs
    };

    await storage.saveCredential(credential);

    const keyPackages: OnboardingKeyPackage[] = [];
    for (let i = 0; i < count; i++) {
      const kp = await wasmGenerateKeyPackage(
        credential.credentialBundle,
        credential.privateKey
      );

      await storage.saveKeyPackage({
        ref: kp.keyPackageRef,
        keyPackage: kp.keyPackage,
        privateKey: kp.privateKey,
        createdAt: kp.createdAtMs
      });

      keyPackages.push({
        keyPackageData: kp.keyPackage,
        keyPackageRef: kp.keyPackageRef
      });
    }

    return { keyPackages };
  } finally {
    storage.close();
  }
}
