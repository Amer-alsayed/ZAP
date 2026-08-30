import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const faviconSvg = fs.readFileSync(path.join(__dirname, '..', 'client', 'public', 'favicon.svg'), 'utf-8');

const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=JetBrains+Mono:ital,wght@0,400..700;1,400..700&display=swap" rel="stylesheet">
  <style>
    :root {
      --font-primary: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "SF Pro", "Inter", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --font-heading: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "SF Pro", "Inter", -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --font-mono: "SF Mono", "ui-monospace", "JetBrains Mono", Menlo, Monaco, Consolas, monospace;
      
      --accent-rgb: 0, 122, 204;
      --accent-main: #007acc;
      --accent-color: var(--accent-main);
      --accent-surface: rgba(0, 122, 204, 0.18);
      --accent-border: rgba(0, 122, 204, 0.35);
      --accent-text: #38bdf8;
      
      --bg-main: #000000;
      --bg-card: #121212;
      --border-color: rgba(255, 255, 255, 0.08);
      --text-primary: #cccccc;
      --text-muted: #888888;
      --text-subtle: #666666;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: var(--font-primary);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    body {
      width: 1280px;
      height: 640px;
      background: var(--bg-main);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      color: var(--text-primary);
      position: relative;
    }

    /* Subtle ambient accent glow behind card */
    .ambient-glow {
      position: absolute;
      width: 600px;
      height: 400px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(var(--accent-rgb), 0.14) 0%, transparent 70%);
      top: 50%;
      left: 30%;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    /* ZAP Authentic Auth-Card Style Container */
    .auth-card-preview {
      width: 1140px;
      height: 520px;
      padding: 56px 64px;
      border-radius: 28px;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.9);
      display: flex;
      align-items: center;
      gap: 60px;
      position: relative;
      z-index: 2;
    }

    /* Logo Container using official SVG */
    .logo-box {
      width: 220px;
      height: 220px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 24px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 16px;
    }

    .logo-box svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    /* Branding Content */
    .content-box {
      display: flex;
      flex-direction: column;
      justify-content: center;
      flex: 1;
    }

    .auth-title {
      font-size: 64px;
      font-weight: 700;
      letter-spacing: -0.8px;
      color: #ffffff;
      line-height: 1;
      margin-bottom: 16px;
      font-family: var(--font-heading);
    }

    .auth-subtitle {
      font-size: 23px;
      line-height: 1.45;
      color: var(--text-muted);
      margin-bottom: 36px;
      max-width: 680px;
    }

    /* Real ZAP Auth Buttons */
    .btn-row {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .auth-btn {
      height: 50px;
      padding: 0 24px;
      background: var(--accent-surface);
      border: 1px solid var(--accent-border);
      border-radius: 16px;
      color: var(--accent-color);
      font-size: 15.5px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      letter-spacing: -0.01em;
    }

    .auth-btn.secondary {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
    }

    .btn-icon {
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</head>
<body>
  <div class="ambient-glow"></div>

  <div class="auth-card-preview">
    <!-- Official ZAP Logo -->
    <div class="logo-box">
      ${faviconSvg}
    </div>

    <!-- Official Copy & Real App Typography -->
    <div class="content-box">
      <h1 class="auth-title">ZAP</h1>
      <p class="auth-subtitle">
        Anonymous, zero-knowledge, end-to-end encrypted messaging & WebRTC voice/video calling.
      </p>
      <div class="btn-row">
        <div class="auth-btn">
          <svg class="btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>End-to-End Encrypted</span>
        </div>
        <div class="auth-btn secondary">
          <svg class="btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          <span>WebRTC P2P Calling</span>
        </div>
        <div class="auth-btn secondary">
          <svg class="btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
          </svg>
          <span>Zero Knowledge</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

async function render() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: 2 });
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

  // Wait for Google Fonts to load
  await page.evaluateHandle('document.fonts.ready');

  const outJpgPath = path.join(__dirname, '..', 'docs', 'assets', 'zap_social_preview.jpg');
  const outPngPath = path.join(__dirname, '..', 'docs', 'assets', 'zap_social_preview.png');
  const publicJpgPath = path.join(__dirname, '..', 'client', 'public', 'social-preview.jpg');

  await page.screenshot({ path: outPngPath, type: 'png' });
  await page.screenshot({ path: outJpgPath, type: 'jpeg', quality: 95 });
  await page.screenshot({ path: publicJpgPath, type: 'jpeg', quality: 95 });

  await browser.close();
  console.log('Successfully rendered official ZAP social preview cards to:', outJpgPath);
}

render().catch(console.error);
