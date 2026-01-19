export interface OpenRouterModelOption {
  id: string;
  name: string;
  description: string;
  isFree: boolean;
}

export const DEFAULT_OPENROUTER_MODEL_ID = 'mistralai/mistral-7b-instruct';

export const OPENROUTER_CHAT_MODELS: OpenRouterModelOption[] = [
  {
    id: DEFAULT_OPENROUTER_MODEL_ID,
    name: 'Mistral 7B Instruct',
    description: 'General-purpose chat model hosted on OpenRouter',
    isFree: false
  }
];

export function isOpenRouterModelId(value: string): boolean {
  return OPENROUTER_CHAT_MODELS.some((model) => model.id === value);
}
