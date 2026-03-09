import { describe, expect, it } from 'vitest';
import { Wallet, WalletDetail, WalletNewItem, WalletWindow } from './index';

describe('wallet package exports', () => {
  it('exports window and page components', () => {
    expect(WalletWindow).toBeDefined();
    expect(Wallet).toBeDefined();
    expect(WalletDetail).toBeDefined();
    expect(WalletNewItem).toBeDefined();
  });
});
