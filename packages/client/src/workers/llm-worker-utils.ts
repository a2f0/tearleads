/**
 * Utility functions for the LLM worker.
 * Extracted for testability and reuse.
 */

/**
 * Apply softmax normalization to an array of values.
 * Converts raw scores to probabilities that sum to 1.
 */
export function softmax(arr: number[]): number[] {
  const max = Math.max(...arr);
  const exps = arr.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((x) => x / sum);
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const aVal = a[i] ?? 0;
    const bVal = b[i] ?? 0;
    dotProduct += aVal * bVal;
    normA += aVal * aVal;
    normB += bVal * bVal;
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Model type detection functions.
 */
export function isClipModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('clip');
}

export function isPaliGemmaModel(modelId: string): boolean {
  return modelId.toLowerCase().includes('paligemma');
}

export function isVisionModel(modelId: string): boolean {
  const lowerModelId = modelId.toLowerCase();
  return lowerModelId.includes('vision') || lowerModelId.includes('vlm');
}

export type ModelType = 'chat' | 'vision' | 'paligemma' | 'clip';

export function getModelType(modelId: string): ModelType {
  if (isClipModel(modelId)) return 'clip';
  if (isPaliGemmaModel(modelId)) return 'paligemma';
  if (isVisionModel(modelId)) return 'vision';
  return 'chat';
}
