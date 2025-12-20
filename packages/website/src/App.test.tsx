import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    render(
      <ThemeProvider>
        <App />
      </ThemeProvider>
    );
  });

  it('renders the home screen', () => {
    expect(screen.getByText('Rapid')).toBeInTheDocument();
    expect(screen.getByText('Welcome to Rapid')).toBeInTheDocument();
    expect(
      screen.getByText('Your marketing content goes here.')
    ).toBeInTheDocument();
  });

  it('renders the header with logo', () => {
    expect(screen.getByAltText('Rapid')).toBeInTheDocument();
  });

  it('renders the footer with copyright', () => {
    const currentYear = new Date().getFullYear();
    expect(
      screen.getByText(`© ${currentYear} Rapid. All rights reserved.`)
    ).toBeInTheDocument();
  });
});
