export interface OpenRouterModelOption {
  id: string;
  name: string;
  description: string;
  isFree: boolean;
  isVision?: boolean;
}

export const DEFAULT_OPENROUTER_MODEL_ID = 'mistralai/mistral-7b-instruct';

export const OPENROUTER_CHAT_MODELS: OpenRouterModelOption[] = [
  {
    id: DEFAULT_OPENROUTER_MODEL_ID,
    name: 'Mistral 7B Instruct',
    description: 'General-purpose chat model hosted on OpenRouter',
    isFree: false,
    isVision: false
  },
  {
    id: 'google/gemma-3-4b-it:free',
    name: 'Gemma 3 4B (Free)',
    description: 'Free vision-capable model hosted on OpenRouter',
    isFree: true,
    isVision: true
  }
];

export function getOpenRouterModelOption(
  modelId: string
): OpenRouterModelOption | null {
  return OPENROUTER_CHAT_MODELS.find((model) => model.id === modelId) ?? null;
}

export function isOpenRouterModelId(value: string): boolean {
  return OPENROUTER_CHAT_MODELS.some((model) => model.id === value);
}
