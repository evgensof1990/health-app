import { createRoot } from 'react-dom/client';
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import './styles.css';
import App from './App.jsx';
import { initNative } from './native.js';

initNative();
createRoot(document.getElementById('root')).render(<App />);
