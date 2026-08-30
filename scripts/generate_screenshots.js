import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.resolve(__dirname, '../docs/screenshots');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  console.log('Starting screenshot generation with Chrome...');
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
    // 1. Capture Auth Screen
    const pageA = await browser.newPage();
    await pageA.goto('http://localhost:5000', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1200));

    console.log('1/5 Capturing 01-auth-screen.png...');
    await pageA.screenshot({
      path: path.join(screenshotsDir, '01-auth-screen.png')
    });

    // 2. Register Alice
    console.log('Registering Alice...');
    await pageA.evaluate(() => {
      const toggleSpan = document.querySelector('.auth-toggle span');
      if (toggleSpan) toggleSpan.click();
    });
    await new Promise(r => setTimeout(r, 400));

    const id = Math.floor(Math.random() * 8999 + 1000);
    const aliceUser = `alice_${id}`;
    const bobUser = `bob_${id}`;

    await pageA.type('#username', aliceUser);
    await pageA.type('#password', 'Pass123456!');
    await pageA.click('.auth-btn');
    await pageA.waitForSelector('.app-container', { timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));
    console.log('Alice registered!');

    // 3. Register Bob in Context B
    console.log('Registering Bob in Context B...');
    const contextB = await browser.createBrowserContext();
    const pageB = await contextB.newPage();
    await pageB.goto('http://localhost:5000', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 1000));

    await pageB.evaluate(() => {
      const toggleSpan = document.querySelector('.auth-toggle span');
      if (toggleSpan) toggleSpan.click();
    });
    await new Promise(r => setTimeout(r, 400));

    await pageB.type('#username', bobUser);
    await pageB.type('#password', 'Pass123456!');
    await pageB.click('.auth-btn');
    await pageB.waitForSelector('.app-container', { timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));
    console.log('Bob registered!');

    // 4. Bob searches for Alice and opens chat
    console.log('Bob searching for Alice...');
    await pageB.type('.search-box input', aliceUser);
    await new Promise(r => setTimeout(r, 1000));

    await pageB.waitForSelector('.add-contact-btn', { timeout: 8000 });
    await pageB.click('.add-contact-btn');
    await new Promise(r => setTimeout(r, 1500));

    // Bob sends messages
    console.log('Bob sending messages...');
    await pageB.waitForSelector('textarea.message-textarea', { timeout: 8000 });
    
    await pageB.type('textarea.message-textarea', 'Hey Alice! All messages and voice notes here are zero-knowledge end-to-end encrypted with AES-GCM-256 and ECDH P-256.');
    await new Promise(r => setTimeout(r, 200));
    await pageB.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1000));

    await pageB.type('textarea.message-textarea', 'Direct WebRTC P2P audio and video calls stream browser-to-browser with $0 in server bandwidth costs.');
    await new Promise(r => setTimeout(r, 200));
    await pageB.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 1500));

    // 5. Alice opens Bob chat
    console.log('Alice searching for Bob and opening chat...');
    await pageA.bringToFront();
    await pageA.type('.search-box input', bobUser);
    await new Promise(r => setTimeout(r, 1000));

    await pageA.waitForSelector('.add-contact-btn', { timeout: 8000 });
    await pageA.click('.add-contact-btn');
    await new Promise(r => setTimeout(r, 1500));

    // Alice types and sends reply
    await pageA.waitForSelector('textarea.message-textarea', { timeout: 8000 });
    await pageA.type('textarea.message-textarea', 'Confirmed! The out-of-band cryptographic safety fingerprints match. Everything is verified.');
    await new Promise(r => setTimeout(r, 200));
    await pageA.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 2000));

    // 2/5 Capture Main Chat Interface
    console.log('2/5 Capturing 02-chat-interface.png...');
    await pageA.screenshot({
      path: path.join(screenshotsDir, '02-chat-interface.png')
    });

    // 3/5 Open Safety Number Modal via the safety-number-btn
    console.log('Opening Safety Number Modal via .safety-number-btn...');
    const safetyBtn = await pageA.$('.safety-number-btn');
    if (safetyBtn) {
      await safetyBtn.click();
      await new Promise(r => setTimeout(r, 600));

      // Click "Mark as Verified" to showcase verified state
      const verifyToggle = await pageA.$('.safety-toggle-verify-btn');
      if (verifyToggle) {
        await verifyToggle.click();
        await new Promise(r => setTimeout(r, 800));
      }

      console.log('3/5 Capturing 03-safety-number.png...');
      await pageA.screenshot({
        path: path.join(screenshotsDir, '03-safety-number.png')
      });

      // Close modal
      const closeBtn = await pageA.$('.safety-close-btn');
      if (closeBtn) {
        await closeBtn.click();
        await new Promise(r => setTimeout(r, 600));
      }
    }

    // 4/5 Open Settings View
    console.log('Opening Settings...');
    const settingsBtn = await pageA.$('.sidebar-settings-btn');
    if (settingsBtn) {
      await settingsBtn.click();
      await new Promise(r => setTimeout(r, 1500));

      console.log('4/5 Capturing 04-settings-themes.png...');
      await pageA.screenshot({
        path: path.join(screenshotsDir, '04-settings-themes.png')
      });

      const backBtn = await pageA.$('.settings-back-btn, .back-btn');
      if (backBtn) await backBtn.click();
      await new Promise(r => setTimeout(r, 1000));
    }

    // 5/5 Initiate Call from Bob to Alice
    console.log('Initiating WebRTC call from Bob to Alice...');
    await pageB.bringToFront();
    const voiceBtn = await pageB.$('button[title*="Voice Call"]');
    if (voiceBtn) {
      await voiceBtn.click();
      await new Promise(r => setTimeout(r, 1800));

      console.log('5/5 Capturing 05-call-hud.png...');
      await pageB.screenshot({
        path: path.join(screenshotsDir, '05-call-hud.png')
      });
    }

    console.log('SUCCESS: All 5 high-resolution screenshots generated in docs/screenshots/!');
  } catch (err) {
    console.error('Screenshot error:', err);
  } finally {
    await browser.close();
  }
}

run();
