import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.resolve(__dirname, '../docs/screenshots');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function run() {
  console.log('Capturing connected WebRTC video call...');
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
    const pageA = await browser.newPage();
    await pageA.goto('http://localhost:5000', { waitUntil: 'networkidle0' });

    const id = Math.floor(Math.random() * 8999 + 1000);
    const aliceUser = `alice_${id}`;
    const bobUser = `bob_${id}`;

    // Register Alice
    await pageA.evaluate(() => {
      const toggleSpan = document.querySelector('.auth-toggle span');
      if (toggleSpan) toggleSpan.click();
    });
    await new Promise(r => setTimeout(r, 400));
    await pageA.type('#username', aliceUser);
    await pageA.type('#password', 'Pass123456!');
    await pageA.click('.auth-btn');
    await pageA.waitForSelector('.app-container', { timeout: 20000 });

    // Register Bob
    const contextB = await browser.createBrowserContext();
    const pageB = await contextB.newPage();
    await pageB.goto('http://localhost:5000', { waitUntil: 'networkidle0' });
    await pageB.evaluate(() => {
      const toggleSpan = document.querySelector('.auth-toggle span');
      if (toggleSpan) toggleSpan.click();
    });
    await new Promise(r => setTimeout(r, 400));
    await pageB.type('#username', bobUser);
    await pageB.type('#password', 'Pass123456!');
    await pageB.click('.auth-btn');
    await pageB.waitForSelector('.app-container', { timeout: 20000 });

    // Bob adds Alice
    await pageB.type('.search-box input', aliceUser);
    await new Promise(r => setTimeout(r, 1000));
    await pageB.waitForSelector('.add-contact-btn', { timeout: 8000 });
    await pageB.click('.add-contact-btn');
    await new Promise(r => setTimeout(r, 1500));

    // Bob starts Video Call
    const videoBtn = await pageB.$('button[title*="Video Call"], button[aria-label*="Video Call"]');
    if (videoBtn) await videoBtn.click();
    await new Promise(r => setTimeout(r, 1500));

    // Alice accepts incoming call
    await pageA.bringToFront();
    await pageA.waitForSelector('.pill-btn.accept, button[title*="Accept"]', { timeout: 8000 });
    const acceptBtn = await pageA.$('.pill-btn.accept, button[title*="Accept"]');
    if (acceptBtn) {
      await acceptBtn.click();
      await new Promise(r => setTimeout(r, 2500));
      
      console.log('Capturing Active WebRTC Video Call...');
      await pageA.screenshot({
        path: path.join(screenshotsDir, '05-call-active.png')
      });
      console.log('SUCCESS: Captured 05-call-active.png');
    }
  } catch (err) {
    console.error('Call capture error:', err);
  } finally {
    await browser.close();
  }
}

run();
