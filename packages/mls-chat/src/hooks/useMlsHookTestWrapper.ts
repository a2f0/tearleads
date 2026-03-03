import { createElement, type ReactNode } from 'react';

import { MlsChatProvider, type MlsChatUIComponents } from '../context/index.js';

const uiComponents: MlsChatUIComponents = {
  Button: ({ children, onClick }) =>
    createElement('button', { type: 'button', onClick }, children),
  Input: ({ value, onChange }) =>
    createElement('input', {
      value,
      onChange: (event: Event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
          return;
        }
        onChange(target.value);
      }
    }),
  Avatar: ({ userId }) => createElement('div', undefined, userId),
  ScrollArea: ({ children }) => createElement('div', undefined, children),
  DropdownMenu: ({ trigger, children }) =>
    createElement('div', undefined, trigger, children),
  DropdownMenuItem: ({ children, onClick }) =>
    createElement('button', { type: 'button', onClick }, children)
};

export function createMlsHookWrapper() {
  return function MlsHookWrapper({ children }: { children: ReactNode }) {
    return createElement(MlsChatProvider, {
      apiBaseUrl: 'http://localhost:3000',
      getAuthHeader: () => 'Bearer token',
      userId: 'test-user-id',
      userEmail: 'test@example.com',
      ui: uiComponents,
      children
    });
  };
}
