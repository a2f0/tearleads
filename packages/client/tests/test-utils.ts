/**
 * Shared test utilities for Playwright e2e tests
 */

import type { Page } from '@playwright/test';

// WAV format constants
const WAV_HEADER_SIZE = 44;
const RIFF_CHUNK_DESCRIPTOR_SIZE = 8; // 'RIFF' identifier + chunk size field
const PCM_SUBCHUNK1_SIZE = 16;
const PCM_AUDIO_FORMAT = 1;
const SILENCE_8BIT = 128; // Center point for 8-bit audio

// Minimal valid WAV for audio upload tests
// PCM 8-bit mono, 8000Hz sample rate, ~0.1 seconds of silence
// WAV format is simpler and more reliably supported than MP3
function createMinimalWav(): Buffer {
  const numChannels = 1;
  const sampleRate = 8000;
  const bitsPerSample = 8;
  const numSamples = 800; // 0.1 seconds of audio
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const fileSize = WAV_HEADER_SIZE + dataSize - RIFF_CHUNK_DESCRIPTOR_SIZE;

  const buffer = Buffer.alloc(WAV_HEADER_SIZE + dataSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset);
  offset += 4;
  buffer.writeUInt32LE(fileSize, offset);
  offset += 4;
  buffer.write('WAVE', offset);
  offset += 4;

  // fmt subchunk
  buffer.write('fmt ', offset);
  offset += 4;
  buffer.writeUInt32LE(PCM_SUBCHUNK1_SIZE, offset);
  offset += 4;
  buffer.writeUInt16LE(PCM_AUDIO_FORMAT, offset);
  offset += 2;
  buffer.writeUInt16LE(numChannels, offset);
  offset += 2;
  buffer.writeUInt32LE(sampleRate, offset);
  offset += 4;
  buffer.writeUInt32LE(byteRate, offset);
  offset += 4;
  buffer.writeUInt16LE(blockAlign, offset);
  offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset);
  offset += 2;

  // data subchunk
  buffer.write('data', offset);
  offset += 4;
  buffer.writeUInt32LE(dataSize, offset);
  offset += 4;

  // Audio data (silence)
  for (let i = 0; i < numSamples; i++) {
    buffer.writeUInt8(SILENCE_8BIT, offset);
    offset += 1;
  }

  return buffer;
}

export const MINIMAL_WAV = createMinimalWav();

// Alias for tests that expect MP3 (WAV works for audio upload tests)
export const MINIMAL_MP3 = MINIMAL_WAV;

// Minimal valid PNG (1x1 red pixel) for file upload tests
// Generated with proper CRC checksums for all chunks
export const MINIMAL_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk (length=13)
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, // bit depth, color type, CRC
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, // IDAT chunk (length=13)
  0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, // compressed RGBA data
  0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, // with CRC
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND chunk (length=0)
  0xae, 0x42, 0x60, 0x82 // IEND CRC
]);

export async function clearOriginStorage(
  page: Page,
  originOverride?: string
): Promise<void> {
  const origin =
    originOverride ??
    new URL(process.env['BASE_URL'] ?? 'http://localhost:3000').origin;
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Storage.clearDataForOrigin', {
      origin,
      storageTypes: 'all'
    });
  } finally {
    try {
      await client.detach();
    } catch {
      // Best-effort cleanup for CDP session.
    }
  }
}
