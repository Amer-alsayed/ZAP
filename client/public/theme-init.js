(function () {
  try {
    var savedRgb = localStorage.getItem('zap_theme_rgb') || localStorage.getItem('chatra_theme_rgb') || '0, 122, 204';
    if (savedRgb) {
      var parts = savedRgb.split(',').map(function (n) { return parseInt(n.trim(), 10); });
      if (parts.length === 3 && !parts.some(isNaN)) {
        var r = parts[0], g = parts[1], b = parts[2];
        var root = document.documentElement;
        var luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        var isVeryDark = luminance < 0.22;
        var isVeryLight = luminance > 0.82;

        root.style.setProperty('--accent-rgb', r + ', ' + g + ', ' + b);

        var effR = isVeryDark ? 241 : r;
        var effG = isVeryDark ? 245 : g;
        var effB = isVeryDark ? 249 : b;

        root.style.setProperty('--accent-main', 'rgb(' + effR + ', ' + effG + ', ' + effB + ')');
        root.style.setProperty('--accent-color', 'rgb(' + effR + ', ' + effG + ', ' + effB + ')');
        root.style.setProperty('--accent-hover', 'rgba(' + effR + ', ' + effG + ', ' + effB + ', 0.85)');

        var textR, textG, textB;
        if (isVeryDark || isVeryLight) {
          textR = 255; textG = 255; textB = 255;
        } else {
          textR = Math.min(255, Math.round(r + (255 - r) * 0.25));
          textG = Math.min(255, Math.round(g + (255 - g) * 0.25));
          textB = Math.min(255, Math.round(b + (255 - b) * 0.25));
        }
        root.style.setProperty('--accent-text', 'rgb(' + textR + ', ' + textG + ', ' + textB + ')');

        var btnText = (isVeryLight || isVeryDark || luminance > 0.55) ? '#09090b' : '#ffffff';
        root.style.setProperty('--accent-btn-text', btnText);
        root.style.setProperty('--switch-thumb-color', (isVeryLight || isVeryDark) ? '#09090b' : '#ffffff');

        if (isVeryDark) {
          root.style.setProperty('--avatar-bg-color', '#2d333b');
          root.style.setProperty('--avatar-text-color', '#ffffff');
          root.style.setProperty('--accent-surface', 'rgba(255, 255, 255, 0.10)');
          root.style.setProperty('--accent-surface-hover', 'rgba(255, 255, 255, 0.16)');
          root.style.setProperty('--accent-border', 'rgba(255, 255, 255, 0.22)');
          root.style.setProperty('--accent-card-active', '#1e2329');
          root.style.setProperty('--accent-glow', 'rgba(255, 255, 255, 0.15)');
          root.style.setProperty('--bg-chat-bubble-sent', 'linear-gradient(135deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.08) 100%)');
        } else if (isVeryLight) {
          root.style.setProperty('--avatar-bg-color', '#f1f5f9');
          root.style.setProperty('--avatar-text-color', '#09090b');
          root.style.setProperty('--accent-surface', 'rgba(255, 255, 255, 0.14)');
          root.style.setProperty('--accent-surface-hover', 'rgba(255, 255, 255, 0.22)');
          root.style.setProperty('--accent-border', 'rgba(255, 255, 255, 0.32)');
          root.style.setProperty('--accent-card-active', '#22272e');
          root.style.setProperty('--accent-glow', 'rgba(255, 255, 255, 0.25)');
          root.style.setProperty('--bg-chat-bubble-sent', 'linear-gradient(135deg, rgba(255, 255, 255, 0.30) 0%, rgba(255, 255, 255, 0.16) 100%)');
        } else {
          root.style.setProperty('--avatar-bg-color', 'rgb(' + r + ', ' + g + ', ' + b + ')');
          root.style.setProperty('--avatar-text-color', luminance > 0.65 ? '#09090b' : '#ffffff');
          root.style.setProperty('--accent-surface', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.16)');
          root.style.setProperty('--accent-surface-hover', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.24)');
          root.style.setProperty('--accent-border', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.35)');
          root.style.setProperty('--accent-card-active', 'rgb(' + Math.round(13 + (r - 13) * 0.16) + ', ' + Math.round(16 + (g - 16) * 0.16) + ', ' + Math.round(18 + (b - 18) * 0.16) + ')');
          root.style.setProperty('--accent-glow', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.3)');
          root.style.setProperty('--bg-chat-bubble-sent', 'linear-gradient(135deg, rgba(' + r + ', ' + g + ', ' + b + ', 0.42) 0%, rgba(' + r + ', ' + g + ', ' + b + ', 0.25) 100%)');
        }
      }
    }
  } catch (e) {}
})();
