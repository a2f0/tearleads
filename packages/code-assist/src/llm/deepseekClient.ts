import OpenAI from "openai";

/**
 * DeepSeek exposes an OpenAI-compatible API, so we drive it through the openai
 * SDK with a custom baseURL. Keeping the provider behind this single factory
 * means swapping to another OpenAI-compatible provider is a config change.
 */
export function createLlmClient(apiKey: string, baseUrl: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: baseUrl });
}
