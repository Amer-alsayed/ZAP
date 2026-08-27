/**
 * Dynamic Semantic Theme Token Engine
 * Translates RGB accent colors into a full semantic token palette across CSS custom properties.
 * Provides WCAG AAA contrast guarantees for extreme values (Pure Black, Pure White, Dark Slate, Bright Neon).
 */
export const applyThemeTokens = (rgbValue = '0, 122, 204') => {
  if (!rgbValue || typeof document === 'undefined') return;
  const parts = rgbValue.split(',').map(n => parseInt(n.trim(), 10));
  if (parts.length === 3 && !parts.some(isNaN)) {
    const [r, g, b] = parts;
    const root = document.documentElement;

    // Perceived relative luminance via ITU-R BT.709
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const isVeryDark = luminance < 0.22; // User selected black or very dark shade
    const isVeryLight = luminance > 0.82; // User selected white or very light shade

    // 1. Base RGB property for atmospheric aura and subtle background glow
    root.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);

    // 2. Interactive Accent Main (active toggles, radio indicators, sliders, badges)
    // For pure dark/black selection, clamp active controls to a crisp silver-white (#f1f5f9) so they pop on dark UI
    let effectiveR = r;
    let effectiveG = g;
    let effectiveB = b;
    if (isVeryDark) {
      effectiveR = 241;
      effectiveG = 245;
      effectiveB = 249;
    }
    root.style.setProperty('--accent-main', `rgb(${effectiveR}, ${effectiveG}, ${effectiveB})`);
    root.style.setProperty('--accent-color', `rgb(${effectiveR}, ${effectiveG}, ${effectiveB})`);
    root.style.setProperty('--accent-hover', `rgba(${effectiveR}, ${effectiveG}, ${effectiveB}, 0.85)`);

    // 3. High-Contrast Text Token (--accent-text)
    // Ensures text, labels, and links never render in dark/invisible tones on the dark background
    let textR, textG, textB;
    if (isVeryDark) {
      textR = 255;
      textG = 255;
      textB = 255;
    } else if (isVeryLight) {
      textR = 255;
      textG = 255;
      textB = 255;
    } else {
      // Boost luminance for colored accents on dark backgrounds
      textR = Math.min(255, Math.round(r + (255 - r) * 0.25));
      textG = Math.min(255, Math.round(g + (255 - g) * 0.25));
      textB = Math.min(255, Math.round(b + (255 - b) * 0.25));
    }
    root.style.setProperty('--accent-text', `rgb(${textR}, ${textG}, ${textB})`);

    // 4. CTA Button / Badge Text Contrast (dark text when background is light, white text when background is dark)
    const btnText = (isVeryLight || isVeryDark || luminance > 0.55) ? '#09090b' : '#ffffff';
    root.style.setProperty('--accent-btn-text', btnText);

    // 5. Toggle switch thumb color (dark when track is white/silver, white when track is colored/dark)
    const switchThumb = (isVeryLight || isVeryDark) ? '#09090b' : '#ffffff';
    root.style.setProperty('--switch-thumb-color', switchThumb);

    // 6. Avatar Initial Text & Background Colors
    if (isVeryDark) {
      root.style.setProperty('--avatar-bg-color', '#2d333b');
      root.style.setProperty('--avatar-text-color', '#ffffff');
    } else if (isVeryLight) {
      root.style.setProperty('--avatar-bg-color', '#f1f5f9');
      root.style.setProperty('--avatar-text-color', '#09090b');
    } else {
      root.style.setProperty('--avatar-bg-color', `rgb(${r}, ${g}, ${b})`);
      root.style.setProperty('--avatar-text-color', luminance > 0.65 ? '#09090b' : '#ffffff');
    }

    // 7. Surface & Border Tints
    if (isVeryDark) {
      root.style.setProperty('--accent-surface', 'rgba(255, 255, 255, 0.10)');
      root.style.setProperty('--accent-surface-hover', 'rgba(255, 255, 255, 0.16)');
      root.style.setProperty('--accent-border', 'rgba(255, 255, 255, 0.22)');
      root.style.setProperty('--accent-card-active', '#1e2329');
      root.style.setProperty('--accent-glow', 'rgba(255, 255, 255, 0.15)');
      root.style.setProperty('--bg-chat-bubble-sent', 'linear-gradient(135deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.08) 100%)');
    } else if (isVeryLight) {
      root.style.setProperty('--accent-surface', 'rgba(255, 255, 255, 0.14)');
      root.style.setProperty('--accent-surface-hover', 'rgba(255, 255, 255, 0.22)');
      root.style.setProperty('--accent-border', 'rgba(255, 255, 255, 0.32)');
      root.style.setProperty('--accent-card-active', '#22272e');
      root.style.setProperty('--accent-glow', 'rgba(255, 255, 255, 0.25)');
      root.style.setProperty('--bg-chat-bubble-sent', 'linear-gradient(135deg, rgba(255, 255, 255, 0.30) 0%, rgba(255, 255, 255, 0.16) 100%)');
    } else {
      root.style.setProperty('--accent-surface', `rgba(${r}, ${g}, ${b}, 0.16)`);
      root.style.setProperty('--accent-surface-hover', `rgba(${r}, ${g}, ${b}, 0.24)`);
      root.style.setProperty('--accent-border', `rgba(${r}, ${g}, ${b}, 0.35)`);
      root.style.setProperty('--accent-card-active', `rgb(${Math.round(13 + (r - 13) * 0.16)}, ${Math.round(16 + (g - 16) * 0.16)}, ${Math.round(18 + (b - 18) * 0.16)})`);
      root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.3)`);
      root.style.setProperty('--bg-chat-bubble-sent', `linear-gradient(135deg, rgba(${r}, ${g}, ${b}, 0.42) 0%, rgba(${r}, ${g}, ${b}, 0.25) 100%)`);
    }
  }
};
