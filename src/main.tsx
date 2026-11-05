import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { setupInstallButton } from './lib/install';

// When a new version is deployed, switch to it on this open instead of the next one.
// Trips and items live in IndexedDB, so a reload mid-trip loses nothing that was added.
registerSW({ immediate: true });

// Shows only when Chrome says the app can be installed, and never inside the installed app.
setupInstallButton(import.meta.env.MODE === 'production' ? 'Install Abeseria' : 'Install Abeseria Dev');

// Test builds say so on every screen, so nobody shops a real trip in them by mistake.
if (import.meta.env.MODE !== 'production') {
  document.title = 'Abeseria (dev)';
  const badge = document.createElement('div');
  badge.className = 'dev-badge';
  badge.textContent = 'DEV · test data';
  document.body.append(badge);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
