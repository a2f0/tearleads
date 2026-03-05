import type { EmailBodyOperations } from '@tearleads/email';
import { decrypt, importKey } from '@tearleads/shared';
import { useCallback, useMemo } from 'react';
import { getKeyManager } from '@/db/crypto';
import { API_BASE_URL, api } from '@/lib/api';
import { getAuthHeaderValue } from '@/lib/authStorage';

const GET_EMAIL_CONNECT_PATH = '/connect/tearleads.v1.VfsService/GetEmail';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function useClientEmailBodyOperations(): EmailBodyOperations {
  const fetchDecryptedBody = useCallback(
    async (emailId: string): Promise<string> => {
      const authHeader = getAuthHeaderValue();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {})
      };

      const response = await fetch(`${API_BASE_URL}${GET_EMAIL_CONNECT_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: emailId })
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch email: ${response.statusText}`);
      }

      const envelope: unknown = await response.json();
      if (!isRecord(envelope)) {
        throw new Error('Invalid email response');
      }

      const json = envelope['json'];
      if (typeof json !== 'string') {
        throw new Error('Invalid email response envelope');
      }

      const emailData: unknown = JSON.parse(json);
      if (!isRecord(emailData)) {
        throw new Error('Invalid email data');
      }

      const rawData = emailData['rawData'];
      if (typeof rawData === 'string' && rawData.length > 0) {
        return rawData;
      }

      const encryptedBodyPath = emailData['encryptedBodyPath'];
      if (
        typeof encryptedBodyPath !== 'string' ||
        encryptedBodyPath.length === 0
      ) {
        throw new Error('Email has no body content');
      }

      const blob = await api.vfs.getBlob(encryptedBodyPath);

      const keyManager = getKeyManager();
      const rawKey = keyManager.getCurrentKey();
      if (!rawKey) {
        throw new Error('Encryption key not available');
      }

      const cryptoKey = await importKey(rawKey);
      const decrypted = await decrypt(blob.data, cryptoKey);
      return new TextDecoder().decode(decrypted);
    },
    []
  );

  return useMemo(() => ({ fetchDecryptedBody }), [fetchDecryptedBody]);
}
