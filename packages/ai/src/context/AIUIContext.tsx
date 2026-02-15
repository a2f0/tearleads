/**
 * AI UI Context for dependency injection.
 * Allows consumers to provide UI components and infrastructure dependencies.
 */

import type { ComponentType, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';

/**
 * Database state
 */
export interface DatabaseState {
  isUnlocked: boolean;
  isLoading: boolean;
  currentInstanceId: string | null;
}

/**
 * Load progress for model loading
 */
export interface LoadProgress {
  text: string;
  progress: number;
}

/**
 * Model type for LLM
 */
export type ModelType = 'chat' | 'vision' | 'paligemma' | 'clip';

/**
 * Chat message format
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Generate callback for streaming tokens
 */
export type GenerateCallback = (text: string) => void;

/**
 * Generate function type
 */
export type GenerateFunction = (
  messages: ChatMessage[],
  onToken: GenerateCallback,
  image?: string
) => Promise<void>;

/**
 * LLM state and operations
 */
export interface LLMState {
  loadedModel: string | null;
  modelType: ModelType | null;
  isLoading: boolean;
  loadProgress: LoadProgress | null;
  error: string | null;
  generate: GenerateFunction;
  abort: () => void;
}

/**
 * Decrypted AI conversation
 */
export interface DecryptedConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Conversations state and operations
 */
export interface ConversationsState {
  list: DecryptedConversation[];
  loading: boolean;
  error: string | null;
  currentId: string | null;
  select: (id: string | null) => Promise<void>;
  create: () => Promise<string>;
  rename: (id: string, title: string) => Promise<void>;
  delete: (id: string) => Promise<void>;
}

/**
 * UI component props interfaces
 */
export interface ButtonProps {
  variant?:
    | 'default'
    | 'ghost'
    | 'destructive'
    | 'outline'
    | 'secondary'
    | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string | undefined;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: () => void;
  children?: ReactNode;
  title?: string;
  asChild?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
}

export interface InlineUnlockProps {
  description: string;
}

export interface InputProps {
  type?: string;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  className?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  'data-testid'?: string;
}

export interface DropdownMenuProps {
  trigger: string;
  children: ReactNode;
}

export interface DropdownMenuItemProps {
  onClick: () => void;
  checked?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export type DropdownMenuSeparatorProps = Record<string, never>;

export type WindowOptionsMenuItemProps = Record<string, never>;

export interface ModelSelectorProps {
  modelDisplayName: string | undefined;
  variant?: 'default' | 'compact';
}

/**
 * UI components that the AI package requires from the consumer
 */
export interface AIUIComponents {
  Button: ComponentType<ButtonProps>;
  Input: ComponentType<InputProps>;
  InlineUnlock: ComponentType<InlineUnlockProps>;
  DropdownMenu: ComponentType<DropdownMenuProps>;
  DropdownMenuItem: ComponentType<DropdownMenuItemProps>;
  DropdownMenuSeparator: ComponentType<DropdownMenuSeparatorProps>;
  WindowOptionsMenuItem: ComponentType<WindowOptionsMenuItemProps>;
  ModelSelector: ComponentType<ModelSelectorProps>;
}

/**
 * Translation keys used by the AI package
 */
export type AITranslationKey =
  | 'newConversation'
  | 'renameConversation'
  | 'deleteConversation'
  | 'conversations'
  | 'send'
  | 'attachImage'
  | 'removeImage'
  | 'cancel'
  | 'delete'
  | 'rename'
  | 'noConversations'
  | 'loadingDatabase'
  | 'noModelLoaded'
  | 'goToModels'
  | 'selectPhoto'
  | 'noPhotos'
  | 'loadingPhotos';

/**
 * Translation function type
 */
export type TranslationFunction = (key: AITranslationKey) => string;

/**
 * Image attachment operations
 */
export interface ImageAttachmentOps {
  /** Get the currently attached image data URL */
  getAttachedImage: () => string | null;
  /** Set the attached image data URL */
  setAttachedImage: (imageDataUrl: string | null) => void;
}

/**
 * AI UI context value interface
 */
export interface AIUIContextValue {
  /** Database state */
  databaseState: DatabaseState;
  /** UI components */
  ui: AIUIComponents;
  /** Translation function */
  t: TranslationFunction;
  /** Z-index for tooltips */
  tooltipZIndex: number;
  /** LLM state and operations */
  llm: LLMState;
  /** Conversations state and operations */
  conversations: ConversationsState;
  /** Navigate to models page (for window mode) */
  navigateToModels?: () => void;
  /** Select a photo (opens photo picker, returns data URL) */
  selectPhoto?: () => Promise<string | null>;
  /** Image attachment operations */
  imageAttachment: ImageAttachmentOps;
  /** Log an error */
  logError: (message: string, details?: string) => void;
  /** Log a warning */
  logWarn: (message: string, details?: string) => void;
}

const AIUIContext = createContext<AIUIContextValue | null>(null);

export interface AIUIProviderProps {
  children: ReactNode;
  databaseState: DatabaseState;
  ui: AIUIComponents;
  t: TranslationFunction;
  tooltipZIndex?: number;
  llm: LLMState;
  conversations: ConversationsState;
  navigateToModels?: () => void;
  selectPhoto?: () => Promise<string | null>;
  imageAttachment: ImageAttachmentOps;
  logError: (message: string, details?: string) => void;
  logWarn: (message: string, details?: string) => void;
}

/**
 * Provider component that supplies all UI dependencies to AI components
 */
export function AIUIProvider({
  children,
  databaseState,
  ui,
  t,
  tooltipZIndex = 10050,
  llm,
  conversations,
  navigateToModels,
  selectPhoto,
  imageAttachment,
  logError,
  logWarn
}: AIUIProviderProps) {
  const value = useMemo<AIUIContextValue>(
    () => ({
      databaseState,
      ui,
      t,
      tooltipZIndex,
      llm,
      conversations,
      imageAttachment,
      logError,
      logWarn,
      ...(navigateToModels && { navigateToModels }),
      ...(selectPhoto && { selectPhoto })
    }),
    [
      databaseState,
      ui,
      t,
      tooltipZIndex,
      llm,
      conversations,
      imageAttachment,
      navigateToModels,
      selectPhoto,
      logError,
      logWarn
    ]
  );

  return <AIUIContext.Provider value={value}>{children}</AIUIContext.Provider>;
}

/**
 * Hook to access AI UI context
 * @throws Error if used outside AIUIProvider
 */
export function useAIUIContext(): AIUIContextValue {
  const context = useContext(AIUIContext);
  if (!context) {
    throw new Error('useAIUIContext must be used within an AIUIProvider');
  }
  return context;
}

/**
 * Hook to access database state
 */
export function useAIDatabaseState(): DatabaseState {
  const { databaseState } = useAIUIContext();
  return databaseState;
}

/**
 * Hook to access UI components
 */
export function useAIUI(): AIUIComponents {
  const { ui } = useAIUIContext();
  return ui;
}

/**
 * Hook to access LLM state and operations
 */
export function useAILLM(): LLMState {
  const { llm } = useAIUIContext();
  return llm;
}

/**
 * Hook to access conversations state and operations
 */
export function useAIConversations(): ConversationsState {
  const { conversations } = useAIUIContext();
  return conversations;
}
