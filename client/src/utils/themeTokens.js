/**
 * Dynamic Semantic Theme Token Engine
 * Translates RGB accent colors into a full semantic token palette across CSS custom properties.
 */
export const applyThemeTokens = (rgbValue = '0, 122, 204') => {
  if (!rgbValue || typeof document === 'undefined') return;
  const parts = rgbValue.split(',').map(n => parseInt(n.trim(), 10));
  if (parts.length === 3 && !parts.some(isNaN)) {
    const [r, g, b] = parts;
    const root = document.documentElement;
    root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
    root.style.setProperty('--accent-main', `rgb(${r}, ${g}, ${b})`);
    root.style.setProperty('--accent-surface', `rgba(${r}, ${g}, ${b}, 0.16)`);
    root.style.setProperty('--accent-surface-hover', `rgba(${r}, ${g}, ${b}, 0.24)`);
    root.style.setProperty('--accent-border', `rgba(${r}, ${g}, ${b}, 0.35)`);
    // Opaque card background color for clean knockout rings
    root.style.setProperty('--accent-card-active', `rgb(${Math.round(13 + (r - 13) * 0.16)}, ${Math.round(16 + (g - 16) * 0.16)}, ${Math.round(18 + (b - 18) * 0.16)})`);
    // Elevated high-contrast text variant
    root.style.setProperty('--accent-text', `rgb(${Math.min(255, r + 45)}, ${Math.min(255, g + 45)}, ${Math.min(255, b + 45)})`);
    // Dynamic text contrast for primary CTA buttons (dark on light/high-luminance accents, white on deep accents)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const btnText = luminance > 0.55 ? '#09090b' : '#ffffff';
    root.style.setProperty('--accent-btn-text', btnText);
    root.style.setProperty('--accent-color', `rgb(${r}, ${g}, ${b})`);
    root.style.setProperty('--accent-hover', `rgba(${r}, ${g}, ${b}, 0.85)`);
    root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.3)`);
    root.style.setProperty('--bg-chat-bubble-sent', `linear-gradient(135deg, rgba(${r}, ${g}, ${b}, 0.42) 0%, rgba(${r}, ${g}, ${b}, 0.25) 100%)`);
  }
};
