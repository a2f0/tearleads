import { describe, expect, it } from 'vitest';
import { computeContentHash, computeContentHashStreaming } from './fileUtils';

describe('file-utils streaming hash', () => {
  it('matches hash from computeContentHash for same bytes', async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const expected = await computeContentHash(data);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data.slice(0, 3));
        controller.enqueue(data.slice(3, 6));
        controller.enqueue(data.slice(6));
        controller.close();
      }
    });

    const actual = await computeContentHashStreaming(stream);

    expect(actual).toBe(expected);
  });

  it('handles empty streams', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      }
    });
    const expectedEmptySha256 =
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const hash = await computeContentHashStreaming(stream);
    expect(hash).toBe(expectedEmptySha256);
  });
});
