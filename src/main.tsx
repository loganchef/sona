import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './components/App';
import './input.css';
import { initPlatform } from './lib/platform';

// Keep Backspace/Delete inside text fields. Some Linux WebViews bubble these
// keys to the webview and trigger navigation/back actions.
window.addEventListener(
  'keydown',
  (event) => {
    const target = event.target as HTMLElement | null;
    const isEditable =
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable;

    if (isEditable && (event.key === 'Backspace' || event.key === 'Delete')) {
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    }
  },
  true,
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Platform detection runs after first paint so the shell can render instantly.
void initPlatform().catch((error) => {
  console.warn('Failed to initialise platform detection:', error);
});