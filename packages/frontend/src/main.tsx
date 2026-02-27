import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import { dir, locale } from './i18n';

// Set document direction and language for RTL support
document.documentElement.dir = dir;
document.documentElement.lang = locale;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
