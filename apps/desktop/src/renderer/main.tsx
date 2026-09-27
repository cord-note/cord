import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './settings/builtin';
import { bootSettings } from './settings/boot';
import './styles/global.css';
import 'shuttle-editor/styles.css';
import './styles/shuttle-theme.css';

bootSettings();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
