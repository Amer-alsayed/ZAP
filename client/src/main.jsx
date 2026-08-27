import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { applyThemeTokens } from './utils/themeTokens'
import './styles/index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// Immediately initialize user theme tokens before React mount
try {
  const savedRgb = localStorage.getItem('chatra_theme_rgb') || localStorage.getItem('zap_theme_rgb');
  if (savedRgb) {
    applyThemeTokens(savedRgb);
  }
} catch (e) {}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
