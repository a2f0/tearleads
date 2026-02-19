/**
 * useLLM hook - re-exports from modular implementation.
 *
 * This file re-exports the LLM hook and related types from the llm/ directory
 * for backward compatibility with existing imports.
 */

export {
  type ChatMessage,
  type ClassificationResult,
  type GenerateCallback,
  type LLMState,
  type LoadProgress,
  resetLLMUIState,
  type UseLLMReturn,
  useLLM
} from './llm';
