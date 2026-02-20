/**
 * Types for useLLM hook and related functionality.
 */

// Types for worker messages
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Message with tool role for tool call results */
export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

/** Tool call structure from OpenRouter */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Assistant message with tool calls */
export interface AssistantToolCallMessage {
  role: 'assistant';
  content: string | null;
  tool_calls: ToolCall[];
}

export type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type OpenRouterMessage =
  | {
      role: 'system' | 'user' | 'assistant';
      content: string | OpenRouterContentPart[];
    }
  | AssistantToolCallMessage
  | ToolMessage;

export type WorkerRequest =
  | { type: 'load'; modelId: string }
  | { type: 'generate'; messages: ChatMessage[]; image?: string }
  | { type: 'classify'; image: string; candidateLabels: string[] }
  | { type: 'unload' }
  | { type: 'abort' };

export type ModelType = 'chat' | 'vision' | 'paligemma' | 'clip';

export type WorkerResponse =
  | { type: 'progress'; file: string; progress: number; total: number }
  | {
      type: 'loaded';
      modelId: string;
      modelType: ModelType;
      durationMs: number;
    }
  | { type: 'token'; text: string }
  | { type: 'done'; durationMs: number; promptType: 'text' | 'multimodal' }
  | {
      type: 'classification';
      labels: string[];
      scores: number[];
      durationMs: number;
    }
  | { type: 'error'; message: string }
  | { type: 'unloaded' };

export interface LoadProgress {
  text: string;
  progress: number;
}

export interface ClassificationResult {
  labels: string[];
  scores: number[];
}

export interface LLMState {
  loadedModel: string | null;
  modelType: ModelType | null;
  isLoading: boolean;
  loadProgress: LoadProgress | null;
  error: string | null;
  isClassifying: boolean;
}

export type GenerateCallback = (text: string) => void;

export interface UseLLMReturn extends LLMState {
  loadModel: (modelId: string) => Promise<void>;
  unloadModel: () => Promise<void>;
  generate: (
    messages: ChatMessage[],
    onToken: GenerateCallback,
    image?: string
  ) => Promise<void>;
  classify: (
    image: string,
    candidateLabels: string[]
  ) => Promise<ClassificationResult>;
  abort: () => void;
  isWebGPUSupported: () => Promise<boolean>;
  /** Model ID that was loaded before page reload (if any) */
  previouslyLoadedModel: string | null;
}

export interface OpenRouterResponse {
  content: string | null;
  toolCalls: ToolCall[] | null;
}
