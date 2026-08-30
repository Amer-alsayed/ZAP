import puppeteer from 'puppeteer-core';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';
import ffmpegStatic from 'ffmpeg-static';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, '../docs');
const rawVideoPath = path.join(docsDir, 'showcase_raw.mp4');
const optimizedGifPath = path.join(docsDir, 'zap-showcase.gif');
const optimizedMp4Path = path.join(docsDir, 'zap-showcase.mp4');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegStatic, args, (error, stdout, stderr) => {
      if (error) {
        console.error('FFmpeg stderr:', stderr);
        return reject(error);
      }
      resolve(stdout);
    });
  });
}

async function recordTour() {
  console.log('Launching Chrome for cinematic demo recording...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--window-size=1440,900',
      '--force-device-scale-factor=2'
    ],
    defaultViewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2
    }
  });

  try {
    const id = Math.floor(Math.random() * 8999 + 1000);
    const aliceUser = `alice_${id}`;
    const bobUser = `bob_${id}`;

    // Isolated Context A for Alice
    const contextA = await browser.createBrowserContext();
    const pageA = await contextA.newPage();
    await pageA.goto('http://localhost:5000', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1000));

    // Register Alice
    console.log('Registering Alice:', aliceUser);
    await pageA.waitForSelector('.auth-toggle span', { timeout: 15000 });
    await pageA.evaluate(() => {
      const toggleSpan = document.querySelector('.auth-toggle span');
      if (toggleSpan) toggleSpan.click();
    });
    await new Promise(r => setTimeout(r, 500));

    await pageA.type('#username', aliceUser);
    await pageA.type('#password', 'Pass123456!');
    await pageA.click('.auth-btn');
    await pageA.waitForSelector('.app-container', { timeout: 20000 });
    await new Promise(r => setTimeout(r, 1200));
    console.log('Alice registered successfully!');

    // Isolated Context B for Bob
    console.log('Registering Bob:', bobUser);
    const contextB = await browser.createBrowserContext();
    const pageB = await contextB.newPage();
    await pageB.goto('http://localhost:5000', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1000));

    await pageB.waitForSelector('.auth-toggle span', { timeout: 15000 });
    await pageB.evaluate(() => {
      const toggleSpan = document.querySelector('.auth-toggle span');
      if (toggleSpan) toggleSpan.click();
    });
    await new Promise(r => setTimeout(r, 500));

    await pageB.type('#username', bobUser);
    await pageB.type('#password', 'Pass123456!');
    await pageB.click('.auth-btn');
    await pageB.waitForSelector('.app-container', { timeout: 20000 });
    await new Promise(r => setTimeout(r, 1200));
    console.log('Bob registered successfully!');

    // Bob adds Alice and sends initial encrypted greeting
    await pageB.type('.search-box input', aliceUser);
    await new Promise(r => setTimeout(r, 1000));
    await pageB.waitForSelector('.add-contact-btn', { timeout: 8000 });
    await pageB.click('.add-contact-btn');
    await new Promise(r => setTimeout(r, 1500));

    await pageB.type('textarea.message-textarea', 'Hey Alice! Zero-knowledge session active. 100% free.');
    await pageB.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1000));

    // Alice adds Bob
    await pageA.bringToFront();
    await pageA.type('.search-box input', bobUser);
    await new Promise(r => setTimeout(r, 1000));
    await pageA.waitForSelector('.add-contact-btn', { timeout: 8000 });
    await pageA.click('.add-contact-btn');
    await new Promise(r => setTimeout(r, 1500));

    // START SCREEN RECORDER on Alice page
    console.log('Starting Screen Recorder...');
    const recorder = new PuppeteerScreenRecorder(pageA, {
      fps: 25,
      ffmpeg_Path: ffmpegStatic,
      videoFrame: {
        width: 1440,
        height: 900
      },
      aspectRatio: '16:9'
    });

    await recorder.start(rawVideoPath);
    await new Promise(r => setTimeout(r, 800));

    // Scene 1: Real-Time Encrypted Typing & Send
    console.log('Scene 1: Encrypted Messaging...');
    const messageInput = await pageA.waitForSelector('textarea.message-textarea');
    await messageInput.type('All messages & media here are zero-knowledge end-to-end encrypted! ⚡', { delay: 30 });
    await new Promise(r => setTimeout(r, 400));
    await pageA.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1200));

    // Scene 2: Apple Emoji Picker & Sending Animated GIF
    console.log('Scene 2: Emoji Picker & Sending GIF...');
    const emojiBtn = await pageA.$('.input-emoji-btn');
    if (emojiBtn) {
      await emojiBtn.click();
      await new Promise(r => setTimeout(r, 800));

      // Click on GIF tab
      const gifTabBtn = await pageA.evaluateHandle(() => {
        const btns = Array.from(document.querySelectorAll('.expression-control-btn'));
        return btns.find(b => b.textContent.includes('GIFs')) || null;
      });

      if (gifTabBtn && gifTabBtn.asElement()) {
        await gifTabBtn.asElement().click();
        await new Promise(r => setTimeout(r, 1200));

        // Click a GIF in the masonry grid
        const gifItems = await pageA.$$('.gif-grid-item');
        if (gifItems.length > 0) {
          await gifItems[0].click();
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    }

    // Scene 3: Fluid Sidebar Collapse & Expand Animation
    console.log('Scene 3: Sidebar Minimize & Expand...');
    const minimizeSidebarBtn = await pageA.$('.minimize-btn');
    if (minimizeSidebarBtn) {
      await minimizeSidebarBtn.click();
      await new Promise(r => setTimeout(r, 1000));
      await minimizeSidebarBtn.click();
      await new Promise(r => setTimeout(r, 1000));
    }

    // Scene 4: App Theme & RGB Accent Customization in Settings
    console.log('Scene 4: Theme & Accent Color Customization...');
    const settingsBtn = await pageA.$('.sidebar-settings-btn');
    if (settingsBtn) {
      await settingsBtn.click();
      await new Promise(r => setTimeout(r, 1200));

      // Cycle through custom accent color dots
      const colorDots = await pageA.$$('.color-dot');
      if (colorDots.length >= 6) {
        // Royal Violet
        await colorDots[1].click();
        await new Promise(r => setTimeout(r, 600));

        // Neon Emerald
        await colorDots[3].click();
        await new Promise(r => setTimeout(r, 600));

        // Cyan Spark
        await colorDots[5].click();
        await new Promise(r => setTimeout(r, 600));

        // Bright Orange
        await colorDots[7] ? await colorDots[7].click() : await colorDots[0].click();
        await new Promise(r => setTimeout(r, 800));
      }

      // Return back to chat
      const backBtn = await pageA.$('.settings-header .back-btn, .back-btn');
      if (backBtn) {
        await backBtn.click();
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    // Scene 5: Cryptographic Safety Fingerprint Verification Modal
    console.log('Scene 5: E2EE Safety Number Verification...');
    const safetyBtn = await pageA.$('.safety-number-btn');
    if (safetyBtn) {
      await safetyBtn.click();
      await new Promise(r => setTimeout(r, 1200));

      // Click "Mark as Verified"
      const verifyToggle = await pageA.$('.safety-toggle-verify-btn');
      if (verifyToggle) {
        await verifyToggle.click();
        await new Promise(r => setTimeout(r, 1200));
      }

      // Close modal smoothly
      const closeBtn = await pageA.$('.safety-close-btn');
      if (closeBtn) {
        await closeBtn.click();
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    await new Promise(r => setTimeout(r, 1200));

    // STOP RECORDER
    console.log('Stopping screen recorder...');
    await recorder.stop();
    console.log('Raw video saved to:', rawVideoPath);

    // Convert raw recording to optimized, high-fidelity GIF
    console.log('Converting recording to high-quality animated GIF...');
    await runFfmpeg([
      '-y',
      '-i', rawVideoPath,
      '-vf', 'fps=14,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=112:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
      optimizedGifPath
    ]);
    console.log('SUCCESS: Generated animated GIF ->', optimizedGifPath);

    // Convert to web-optimized MP4
    console.log('Rendering web-optimized MP4...');
    await runFfmpeg([
      '-y',
      '-i', rawVideoPath,
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '22',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      optimizedMp4Path
    ]);
    console.log('SUCCESS: Generated MP4 ->', optimizedMp4Path);

  } catch (err) {
    console.error('Error during tour recording:', err);
  } finally {
    await browser.close();
  }
}

recordTour();
