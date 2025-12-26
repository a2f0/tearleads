/// <reference types="astro/client" />

declare module '*.md' {
  import type { MarkdownInstance } from 'astro';
  const content: MarkdownInstance<Record<string, unknown>>;
  export const Content: typeof content.Content;
  export default content;
}
