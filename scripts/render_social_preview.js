import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      width: 1280px;
      height: 640px;
      background: #090a0f;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
      color: #ffffff;
      position: relative;
    }

    /* Subtle ambient glow */
    .ambient-bg {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: 
        radial-gradient(circle at 22% 50%, rgba(0, 198, 255, 0.08) 0%, transparent 45%),
        radial-gradient(circle at 80% 30%, rgba(0, 114, 255, 0.05) 0%, transparent 50%),
        radial-gradient(circle at 50% 100%, rgba(15, 23, 42, 0.8) 0%, transparent 60%);
      pointer-events: none;
    }

    /* Outer Card Border Frame */
    .card-container {
      width: 1180px;
      height: 540px;
      background: rgba(13, 16, 23, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 28px;
      display: flex;
      align-items: center;
      padding: 0 70px;
      gap: 64px;
      box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.06);
      position: relative;
      z-index: 1;
    }

    /* Left: Logo Mark */
    .logo-wrapper {
      flex-shrink: 0;
      width: 210px;
      height: 210px;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .logo-svg {
      width: 100%;
      height: 100%;
    }

    /* Right: Typography & Copy */
    .content {
      display: flex;
      flex-direction: column;
      justify-content: center;
      max-width: 680px;
    }

    .brand-title {
      font-size: 72px;
      font-weight: 850;
      letter-spacing: -0.045em;
      line-height: 1;
      color: #ffffff;
      margin-bottom: 20px;
    }

    .brand-title .tld {
      color: #38bdf8;
      font-weight: 700;
      font-size: 56px;
      letter-spacing: -0.03em;
    }

    .subtitle {
      font-size: 27px;
      line-height: 1.4;
      color: #94a3b8;
      font-weight: 450;
      margin-bottom: 34px;
      letter-spacing: -0.015em;
    }

    .badge-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 16px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 100px;
      font-size: 13.5px;
      font-weight: 600;
      color: #cbd5e1;
      letter-spacing: 0.01em;
      font-family: 'JetBrains Mono', monospace;
    }

    .badge-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #38bdf8;
      box-shadow: 0 0 10px #38bdf8;
    }
  </style>
</head>
<body>
  <div class="ambient-bg"></div>

  <div class="card-container">
    <!-- Clean Minimalist Vector Logo -->
    <div class="logo-wrapper">
      <svg class="logo-svg" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- Outer Concentric Arc Waves -->
        <path d="M 26 100 A 74 74 0 1 1 174 100" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" fill="none" />
        <path d="M 8 100 A 92 92 0 1 1 192 100" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" fill="none" opacity="0.3" />
        <path d="M 44 146 A 74 74 0 0 1 26 100" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" fill="none" />
        
        <!-- Speech Bubble Base -->
        <path d="M 100 52 C 73.5 52 52 73.5 52 100 C 52 112.5 56.8 123.8 64.6 132.3 L 58 152 L 79.5 145.8 C 85.8 147.2 92.8 148 100 148 C 126.5 148 148 126.5 148 100 C 148 73.5 126.5 52 100 52 Z" fill="#FFFFFF" />
        
        <!-- Lightning Bolt Cutout -->
        <path d="M 104 68 L 83 102 H 101 L 96 132 L 121 98 H 102 L 108 68 Z" fill="#090a0f" />
      </svg>
    </div>

    <!-- Content Hierarchy -->
    <div class="content">
      <h1 class="brand-title">zap<span class="tld">.chat</span></h1>
      <p class="subtitle">
        Private, peer-to-peer chat with voice, video and file sharing.
      </p>
      <div class="badge-row">
        <div class="badge">
          <span class="badge-dot"></span>
          End-to-End Encrypted
        </div>
        <div class="badge">
          <span class="badge-dot" style="background:#10b981; box-shadow:0 0 10px #10b981;"></span>
          WebRTC P2P Voice & Video
        </div>
        <div class="badge">
          <span class="badge-dot" style="background:#a855f7; box-shadow:0 0 10px #a855f7;"></span>
          Zero Knowledge
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
  console.log('Successfully rendered crisp 1280x640 social preview cards to:', outJpgPath);
}

render().catch(console.error);
