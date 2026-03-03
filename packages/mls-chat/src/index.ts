/**
 * @tearleads/mls-chat
 *
 * MLS (RFC 9420) chat UI package backed by @tearleads/mls-core.
 * NOTE: Cryptography is currently placeholder-only until Rust MLS integration lands.
 */

// Components
export {
  AddMemberDialog,
  type AddMemberDialogProps,
  GroupList,
  MemberList,
  MlsChatWindow,
  MlsComposer,
  MlsMessage,
  NewGroupDialog,
  type NewGroupDialogProps
} from './components/index.js';
// Context and provider
export {
  type AvatarProps,
  type ButtonProps,
  type DropdownMenuItemProps,
  type DropdownMenuProps,
  type InputProps,
  type MlsChatContextValue,
  MlsChatProvider,
  type MlsChatProviderProps,
  type MlsChatUIComponents,
  type ScrollAreaProps,
  useMlsChatApi,
  useMlsChatContext,
  useMlsChatUI,
  useMlsChatUser
} from './context/index.js';
// Hooks
export {
  useGroupMembers,
  useGroupMessages,
  useGroups,
  useKeyPackages,
  useMlsClient,
  useMlsRealtime,
  useWelcomeMessages
} from './hooks/index.js';
// Types
export type {
  ActiveGroup,
  DecryptedMessage,
  LocalKeyPackage,
  LocalMlsState,
  MlsCredential,
  SseConnectionState
} from './lib/index.js';
// MLS client (for advanced usage)
export { MlsClient, MlsStorage } from './lib/index.js';
// Pages
export { MlsChat } from './pages/index.js';
