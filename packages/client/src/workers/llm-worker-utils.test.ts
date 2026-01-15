import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  getModelType,
  isClipModel,
  isPaliGemmaModel,
  isVisionModel,
  softmax
} from './llm-worker-utils';

describe('llm-worker-utils', () => {
  describe('softmax', () => {
    it('converts raw scores to probabilities summing to 1', () => {
      const result = softmax([1, 2, 3]);
      const sum = result.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    });

    it('handles single element', () => {
      const result = softmax([5]);
      expect(result).toEqual([1]);
    });
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const a = new Float32Array([1, 2, 3]);
      const b = new Float32Array([1, 2, 3]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });

    it('returns -1 for opposite vectors', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([-1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([0, 1, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it('treats missing values as zero', () => {
      const a = new Float32Array([1, 2, 0]);
      const b = new Float32Array([3]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1 / Math.sqrt(5), 5);
    });

    it('handles shorter left-hand vectors', () => {
      const a = new Float32Array([2]);
      const b = new Float32Array([2, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });
  });

  describe('model type detection', () => {
    it('detects clip models', () => {
      expect(isClipModel('openai/clip-vit-base')).toBe(true);
      expect(isClipModel('CLIP-model')).toBe(true);
      expect(isClipModel('some-other-model')).toBe(false);
    });

    it('detects paligemma models', () => {
      expect(isPaliGemmaModel('google/paligemma-3b')).toBe(true);
      expect(isPaliGemmaModel('PaliGemma-test')).toBe(true);
      expect(isPaliGemmaModel('gemma-2b')).toBe(false);
    });

    it('detects vision models', () => {
      expect(isVisionModel('vision-language-model')).toBe(true);
      expect(isVisionModel('my-vlm-model')).toBe(true);
      expect(isVisionModel('text-only-model')).toBe(false);
    });

    it('getModelType returns correct type', () => {
      expect(getModelType('clip-vit')).toBe('clip');
      expect(getModelType('paligemma-3b')).toBe('paligemma');
      expect(getModelType('vision-encoder')).toBe('vision');
      expect(getModelType('llama-2')).toBe('chat');
    });
  });
});
