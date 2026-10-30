import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
if (import.meta.env.VITE_QA_STAND === 'true') {
  import('./QaStand').then(({ default: QaStand }) => {
    createRoot(document.getElementById('root')!).render(<React.StrictMode><QaStand><App/></QaStand></React.StrictMode>);
  });
} else {
  createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
}
