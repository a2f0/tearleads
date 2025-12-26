import { ThemeProvider } from '@rapid/ui';
import mermaid from 'mermaid';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  themeVariables: {
    primaryColor: '#e2e8f0',
    primaryTextColor: '#1e293b',
    primaryBorderColor: '#64748b',
    lineColor: '#64748b',
    secondaryColor: '#cbd5e1',
    tertiaryColor: '#f1f5f9',
    background: '#ffffff',
    mainBkg: '#f8fafc',
    nodeBorder: '#64748b',
    clusterBkg: '#f8fafc',
    clusterBorder: '#94a3b8',
    titleColor: '#0f172a',
    edgeLabelBackground: '#ffffff'
  },
  flowchart: {
    curve: 'basis',
    padding: 20,
    nodeSpacing: 50,
    rankSpacing: 80,
    htmlLabels: true
  }
});

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </React.StrictMode>
  );
}
