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
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
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
    await messageInput.type('All messages & calls here are zero-knowledge end-to-end encrypted! ⚡', { delay: 30 });
    await new Promise(r => setTimeout(r, 400));
    await pageA.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1200));

    // Scene 2: Apple Emoji Picker & Reaction
    console.log('Scene 2: Apple Emoji Picker...');
    const emojiBtn = await pageA.$('.input-emoji-btn');
    if (emojiBtn) {
      await emojiBtn.click();
      await new Promise(r => setTimeout(r, 800));

      const emojiButtons = await pageA.$$('.apple-emoji-grid button, .emoji-item, .apple-emoji-item');
      if (emojiButtons.length > 5) {
        await emojiButtons[2].click();
        await new Promise(r => setTimeout(r, 250));
        await emojiButtons[4].click();
        await new Promise(r => setTimeout(r, 250));
        await emojiButtons[6].click();
        await new Promise(r => setTimeout(r, 250));
      }

      await new Promise(r => setTimeout(r, 600));
      await emojiBtn.click(); // close picker
      await new Promise(r => setTimeout(r, 600));

      await pageA.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 1000));
    }

    // Scene 3: E2EE Safety Number Verification Modal
    console.log('Scene 3: Cryptographic Fingerprint Verification...');
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
        await new Promise(r => setTimeout(r, 800));
      }
    }

    // Scene 4: WebRTC Video Call & Picture-in-Picture (PiP) Dragging
    console.log('Scene 4: WebRTC P2P Video Call & Picture-in-Picture Dragging...');
    const videoCallBtn = await pageA.$('button[title*="Video Call"], button[aria-label*="Video Call"]');
    if (videoCallBtn) {
      await videoCallBtn.click();
      await new Promise(r => setTimeout(r, 1500));

      // Bob accepts call in Context B
      await pageB.waitForSelector('.pill-btn.accept, button[title*="Accept"]', { timeout: 8000 });
      const acceptBtn = await pageB.$('.pill-btn.accept, button[title*="Accept"]');
      if (acceptBtn) {
        await acceptBtn.click();
      }

      await new Promise(r => setTimeout(r, 2500));

      // Alice minimizes call to PiP mode
      console.log('Minimizing call to floating PiP window...');
      const minimizeBtn = await pageA.$('.call-btn.minimize, button[title*="Minimize"]');
      if (minimizeBtn) {
        await minimizeBtn.click();
        await new Promise(r => setTimeout(r, 1500));

        // Drag floating PiP window across screen
        console.log('Dragging PiP window across screen...');
        const pipOverlay = await pageA.$('.call-overlay.pip-mode');
        if (pipOverlay) {
          const box = await pipOverlay.boundingBox();
          if (box) {
            const startX = box.x + box.width / 2;
            const startY = box.y + box.height / 2;

            await pageA.mouse.move(startX, startY);
            await pageA.mouse.down();
            await new Promise(r => setTimeout(r, 80));

            // Smooth drag to top-left area
            for (let i = 0; i <= 25; i++) {
              const curX = startX - (startX - 340) * (i / 25);
              const curY = startY - (startY - 140) * (i / 25);
              await pageA.mouse.move(curX, curY);
              await new Promise(r => setTimeout(r, 20));
            }
            await pageA.mouse.up();
            await new Promise(r => setTimeout(r, 800));

            // Type while floating call is active
            await messageInput.type('Multitasking seamlessly with movable PiP calls! 🚀', { delay: 30 });
            await pageA.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 1200));

            // Drag PiP back to bottom-right
            const newBox = await pipOverlay.boundingBox();
            if (newBox) {
              const nX = newBox.x + newBox.width / 2;
              const nY = newBox.y + newBox.height / 2;
              await pageA.mouse.move(nX, nY);
              await pageA.mouse.down();
              for (let i = 0; i <= 25; i++) {
                const curX = nX + (1120 - nX) * (i / 25);
                const curY = nY + (540 - nY) * (i / 25);
                await pageA.mouse.move(curX, curY);
                await new Promise(r => setTimeout(r, 20));
              }
              await pageA.mouse.up();
              await new Promise(r => setTimeout(r, 1000));
            }
          }
        }

        // End Call
        const endCallBtn = await pageA.$('.call-btn.decline, button[title*="Cancel Call"], button[title*="End Call"]');
        if (endCallBtn) {
          await endCallBtn.click();
          await new Promise(r => setTimeout(r, 1200));
        }
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
      '-vf', 'fps=12,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3',
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
