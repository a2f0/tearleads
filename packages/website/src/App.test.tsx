import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

const renderApp = () => {
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
};

describe('App', () => {
  it('renders the home screen', () => {
    renderApp();
    expect(
      screen.getByRole('heading', { name: 'Rapid', level: 1 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Welcome to Rapid', level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Your marketing content goes here.')
    ).toBeInTheDocument();
  });

  it('renders the header with logo', () => {
    renderApp();
    expect(screen.getByAltText('Rapid')).toBeInTheDocument();
  });

  it('renders the footer with copyright', () => {
    renderApp();
    expect(
      screen.getByText(/© \d{4} Rapid\. All rights reserved\./)
    ).toBeInTheDocument();
  });
});
