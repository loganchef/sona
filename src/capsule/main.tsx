import React from 'react';
import ReactDOM from 'react-dom/client';
import { Capsule } from './Capsule';
import '../input.css';
import './capsule.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Capsule />
  </React.StrictMode>,
);
