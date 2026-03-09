import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  getWalletItemTypeLabel,
  WALLET_ITEM_TYPES
} from '../../lib/walletData';
import { WalletItemTypePicker } from './WalletItemTypePicker';

describe('WalletItemTypePicker', () => {
  it('renders a selection square for each wallet item type', () => {
    render(<WalletItemTypePicker onSelectItemType={vi.fn()} />);

    for (const itemType of WALLET_ITEM_TYPES) {
      expect(
        screen.getByRole('button', {
          name: new RegExp(getWalletItemTypeLabel(itemType), 'i')
        })
      ).toBeInTheDocument();
    }
  });

  it('calls onSelectItemType with the clicked type', async () => {
    const onSelectItemType = vi.fn();
    const user = userEvent.setup();

    render(<WalletItemTypePicker onSelectItemType={onSelectItemType} />);

    await user.click(screen.getByTestId('wallet-item-type-insuranceCard'));

    expect(onSelectItemType).toHaveBeenCalledTimes(1);
    expect(onSelectItemType).toHaveBeenCalledWith('insuranceCard');
  });
});
