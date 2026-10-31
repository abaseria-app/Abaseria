import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import App from './App';

// When a new version is deployed, switch to it on this open instead of the next one.
// Trips and items live in IndexedDB, so a reload mid-trip loses nothing that was added.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
