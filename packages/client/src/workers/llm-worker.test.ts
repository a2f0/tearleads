import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cosineSimilarity,
  getModelType,
  isClipModel,
  isPaliGemmaModel,
  isVisionModel,
  softmax
} from './llm-worker-utils';

// Mock transformers.js
vi.mock('@huggingface/transformers', () => ({
  AutoModelForCausalLM: { from_pretrained: vi.fn() },
  AutoModelForVision2Seq: { from_pretrained: vi.fn() },
  AutoProcessor: { from_pretrained: vi.fn() },
  AutoTokenizer: { from_pretrained: vi.fn() },
  CLIPModel: { from_pretrained: vi.fn() },
  PaliGemmaForConditionalGeneration: { from_pretrained: vi.fn() },
  RawImage: { fromURL: vi.fn() },
  TextStreamer: vi.fn(),
  env: { allowLocalModels: false }
}));

// Test the actual helper functions from llm-worker-utils
describe('llm-worker-utils', () => {
  describe('softmax', () => {
    it('normalizes array to probabilities that sum to 1', () => {
      const input = [1, 2, 3];
      const result = softmax(input);

      // Sum should be approximately 1
      const sum = result.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);

      // Higher input values should have higher probabilities
      const [r0, r1, r2] = result;
      expect(r2).toBeGreaterThan(r1 ?? 0);
      expect(r1).toBeGreaterThan(r0 ?? 0);
    });

    it('handles negative values', () => {
      const input = [-1, 0, 1];
      const result = softmax(input);

      const sum = result.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    });

    it('handles equal values', () => {
      const input = [2, 2, 2];
      const result = softmax(input);

      // All probabilities should be equal
      const [r0, r1, r2] = result;
      expect(r0).toBeCloseTo(r1 ?? 0, 5);
      expect(r1).toBeCloseTo(r2 ?? 0, 5);
      expect(r0).toBeCloseTo(1 / 3, 5);
    });
  });

  describe('cosineSimilarity', () => {
    it('returns 1 for identical vectors', () => {
      const vec = new Float32Array([1, 2, 3]);
      const result = cosineSimilarity(vec, vec);
      expect(result).toBeCloseTo(1, 5);
    });

    it('returns -1 for opposite vectors', () => {
      const vec1 = new Float32Array([1, 2, 3]);
      const vec2 = new Float32Array([-1, -2, -3]);
      const result = cosineSimilarity(vec1, vec2);
      expect(result).toBeCloseTo(-1, 5);
    });

    it('returns 0 for orthogonal vectors', () => {
      const vec1 = new Float32Array([1, 0, 0]);
      const vec2 = new Float32Array([0, 1, 0]);
      const result = cosineSimilarity(vec1, vec2);
      expect(result).toBeCloseTo(0, 5);
    });
  });

  describe('model type detection', () => {
    it('detects CLIP models', () => {
      expect(isClipModel('Xenova/clip-vit-base-patch32')).toBe(true);
      expect(isClipModel('openai/CLIP-model')).toBe(true);
      expect(isClipModel('some-other-model')).toBe(false);
    });

    it('detects PaliGemma models', () => {
      expect(isPaliGemmaModel('google/paligemma-3b')).toBe(true);
      expect(
        isPaliGemmaModel('onnx-community/paligemma2-3b-ft-docci-448')
      ).toBe(true);
      expect(isPaliGemmaModel('other-model')).toBe(false);
    });

    it('detects vision models', () => {
      expect(isVisionModel('HuggingFaceTB/SmolVLM-256M-Instruct')).toBe(true);
      expect(isVisionModel('some-vision-model')).toBe(true);
      expect(isVisionModel('chat-model')).toBe(false);
    });

    it('returns correct model type', () => {
      expect(getModelType('Xenova/clip-vit-base-patch32')).toBe('clip');
      expect(getModelType('onnx-community/paligemma2-3b-ft-docci-448')).toBe(
        'paligemma'
      );
      expect(getModelType('HuggingFaceTB/SmolVLM-256M-Instruct')).toBe(
        'vision'
      );
      expect(
        getModelType('onnx-community/Phi-3.5-mini-instruct-onnx-web')
      ).toBe('chat');
    });
  });
});

describe('classification scoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes similarity scores for multiple labels', () => {
    // Simulate embeddings
    const imageEmbed = new Float32Array([0.8, 0.1, 0.1]); // Similar to "passport"
    const passportEmbed = new Float32Array([0.9, 0.1, 0.0]); // passport text embed
    const licenseEmbed = new Float32Array([0.1, 0.9, 0.0]); // license text embed

    const embedDim = 3;
    const textEmbeds = new Float32Array([...passportEmbed, ...licenseEmbed]);
    const labels = ['passport', 'drivers license'];

    // Compute similarities
    const similarities: number[] = [];
    for (let i = 0; i < labels.length; i++) {
      const textEmbed = textEmbeds.slice(i * embedDim, (i + 1) * embedDim);
      const similarity = cosineSimilarity(imageEmbed, textEmbed);
      similarities.push(similarity);
    }

    // Apply softmax
    const scores = softmax(similarities);

    // Passport should have higher score since image embed is similar
    const [s0, s1] = scores;
    expect(s0).toBeGreaterThan(s1 ?? 0);
    expect((s0 ?? 0) + (s1 ?? 0)).toBeCloseTo(1, 5);
  });
});
