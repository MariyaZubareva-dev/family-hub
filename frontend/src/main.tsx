import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import BrowserAuth from './BrowserAuth';
import './ios-pwa.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserAuth><App/></BrowserAuth></React.StrictMode>);

// Register only on secure, production deployments. Service worker caches no private API data.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
      console.warn('Family Hub PWA service worker registration failed:', error);
    });
  });
}
