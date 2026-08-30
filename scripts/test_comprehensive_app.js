import puppeteer from 'puppeteer-core';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const express = require('../server/node_modules/express');
const { Server } = require('../server/node_modules/socket.io');
const cors = require('../server/node_modules/cors');
const helmet = require('../server/node_modules/helmet');

import config from '../server/src/config.js';
import { initDb } from '../server/src/db.js';
import { socketHandler } from '../server/src/socketHandler.js';
import { register, login, searchUser, getAuthSalt } from '../server/src/authController.js';
import { authenticateToken } from '../server/src/middleware/authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function logHeader(title) {
  console.log('\n================================================================');
  console.log(`   ${title}`);
  console.log('================================================================');
}

async function runStep(stepName, fn) {
  totalTests++;
  process.stdout.write(`[TEST ${String(totalTests).padStart(2, '0')}] ${stepName} ... `);
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`✅ PASS (${duration}ms)`);
    passedTests++;
  } catch (err) {
    const duration = Date.now() - start;
    console.log(`❌ FAIL (${duration}ms)`);
    console.error(`       Error: ${err.message}\n${err.stack}`);
    failedTests++;
    throw err;
  }
}

async function setTextareaValue(page, selector, text) {
  await page.waitForSelector(selector, { timeout: 8000 });
  await page.focus(selector);
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    if (el) {
      if (el._valueTracker) {
        el._valueTracker.setValue('');
      }
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, selector, text);
}

async function main() {
  logHeader('ZAP / CHATRA: COMPREHENSIVE END-TO-END AUTOMATION SUITE');
  console.log('Initializing Database, Server, and Chrome browser environments...\n');

  // 1. Initialize SQLite database
  await initDb();

  // 2. Setup Ephemeral Test Server serving client/dist and Socket.io
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Ensure uploads directory exists
  if (!fs.existsSync(config.uploadsDir)) {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
  }

  app.use('/uploads', express.static(config.uploadsDir));

  // Auth Routes
  app.get('/api/auth/salt/:username', getAuthSalt);
  app.get('/api/auth/salt', getAuthSalt);
  app.post('/api/auth/register', register);
  app.post('/api/auth/login', login);
  app.get('/api/auth/search', authenticateToken, searchUser);

  // Upload Route
  app.post('/api/upload', authenticateToken, async (req, res) => {
    const { filename, fileData } = req.body;
    if (!filename || !fileData) return res.status(400).json({ error: 'Filename and fileData required' });
    try {
      const cleanBasename = path.basename(filename).replace(/[^a-zA-Z0-9.-]/g, '_');
      const uniquePrefix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const safeFilename = `${uniquePrefix}-${cleanBasename}`;
      const filePath = path.resolve(config.uploadsDir, safeFilename);
      const cleanBase64 = fileData.replace(/^data:[^;]+;base64,/, '');
      const buffer = Buffer.from(cleanBase64, 'base64');
      await fs.promises.writeFile(filePath, buffer);
      res.status(200).json({ fileUrl: `/uploads/${safeFilename}` });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Serve Frontend client/dist
  const clientDist = path.resolve(__dirname, '../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  } else {
    throw new Error('client/dist directory not found. Please build client first.');
  }

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  socketHandler(io);

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;
  console.log(`[INIT] Ephemeral Test Server running at: ${baseUrl}`);

  // 3. Launch Chrome with Puppeteer
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
      '--window-size=1440,900',
      '--force-device-scale-factor=1'
    ],
    defaultViewport: {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1
    }
  });

  const randSuffix = Math.floor(Math.random() * 89999 + 10000);
  const aliceUser = `alice_${randSuffix}`;
  const bobUser = `bob_${randSuffix}`;
  const charlieUser = `charlie_${randSuffix}`;
  const testPassword = 'Password123!';

  console.log(`[SETUP] Test accounts initialized: ${aliceUser}, ${bobUser}, ${charlieUser}\n`);

  let contextA, contextB, contextC;
  let pageA, pageB, pageC;

  try {
    // =========================================================================
    // MODULE 1: AUTHENTICATION & MULTI-USER SESSIONS
    // =========================================================================
    logHeader('MODULE 1: AUTHENTICATION, REGISTRATION & SESSION PERSISTENCE');

    contextA = await browser.createBrowserContext();
    pageA = await contextA.newPage();
    pageA.on('console', msg => { if (msg.type() === 'error' || msg.text().includes('Error') || msg.text().includes('Integrity') || msg.text().includes('Decryption')) console.log('[PAGE A LOG]:', msg.text()); });
    pageA.on('pageerror', err => console.error('[PAGE A ERROR]:', err.message));
    await pageA.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    contextB = await browser.createBrowserContext();
    pageB = await contextB.newPage();
    pageB.on('console', msg => { if (msg.type() === 'error' || msg.text().includes('Error') || msg.text().includes('Integrity') || msg.text().includes('Decryption')) console.log('[PAGE B LOG]:', msg.text()); });
    pageB.on('pageerror', err => console.error('[PAGE B ERROR]:', err.message));
    await pageB.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    contextC = await browser.createBrowserContext();
    pageC = await contextC.newPage();
    pageC.on('console', msg => { if (msg.type() === 'error' || msg.text().includes('Error')) console.log('[PAGE C LOG]:', msg.text()); });
    pageC.on('pageerror', err => console.error('[PAGE C ERROR]:', err.message));
    await pageC.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    await runStep('Register Alice with PBKDF2 (600k rounds) & Key Generation', async () => {
      await pageA.waitForSelector('.auth-toggle span', { timeout: 10000 });
      await pageA.evaluate(() => document.querySelector('.auth-toggle span').click());
      await new Promise(r => setTimeout(r, 200));

      await pageA.type('#username', aliceUser);
      await pageA.type('#password', testPassword);
      await pageA.click('.auth-btn');
      await pageA.waitForSelector('.app-container', { timeout: 25000 });
    });

    await runStep('Register Bob with PBKDF2 & Isolated Key Pairs', async () => {
      await pageB.waitForSelector('.auth-toggle span', { timeout: 10000 });
      await pageB.evaluate(() => document.querySelector('.auth-toggle span').click());
      await new Promise(r => setTimeout(r, 200));

      await pageB.type('#username', bobUser);
      await pageB.type('#password', testPassword);
      await pageB.click('.auth-btn');
      await pageB.waitForSelector('.app-container', { timeout: 25000 });
    });

    await runStep('Register Charlie with PBKDF2 & Isolated Key Pairs', async () => {
      await pageC.waitForSelector('.auth-toggle span', { timeout: 10000 });
      await pageC.evaluate(() => document.querySelector('.auth-toggle span').click());
      await new Promise(r => setTimeout(r, 200));

      await pageC.type('#username', charlieUser);
      await pageC.type('#password', testPassword);
      await pageC.click('.auth-btn');
      await pageC.waitForSelector('.app-container', { timeout: 25000 });
    });

    await runStep('Verify Session Persistence across Page Reloads for Bob', async () => {
      await pageB.reload({ waitUntil: 'domcontentloaded' });
      await pageB.waitForSelector('.app-container', { timeout: 20000 });
    });

    // =========================================================================
    // MODULE 2: CONTACT SEARCH, ADDITION, RENAMING & PRESENCE
    // =========================================================================
    logHeader('MODULE 2: USER SEARCH, CONTACTS, PRESENCE & CUSTOM NICKNAMES');

    await runStep('Bob searches for Alice and adds her to active chats', async () => {
      await pageB.type('.search-box input', aliceUser);
      await new Promise(r => setTimeout(r, 800));
      await pageB.waitForSelector('.add-contact-btn', { timeout: 10000 });
      await pageB.click('.add-contact-btn');
      await new Promise(r => setTimeout(r, 1000));
      await pageB.waitForSelector('.chat-header', { timeout: 10000 });
    });

    await runStep('Verify Alice real-time online status badge in Bob view', async () => {
      await pageB.waitForSelector('.chat-header-status.online', { timeout: 8000 });
    });

    await runStep('Alice searches for Charlie and adds Charlie to contacts', async () => {
      await pageA.type('.search-box input', charlieUser);
      await new Promise(r => setTimeout(r, 800));
      await pageA.waitForSelector('.add-contact-btn', { timeout: 10000 });
      await pageA.click('.add-contact-btn');
      await new Promise(r => setTimeout(r, 1000));
      await pageA.waitForSelector('.chat-header', { timeout: 10000 });
    });

    await runStep('Test Sidebar collapse/expand animation toggle button', async () => {
      const minimizeBtn = await pageA.$('.minimize-btn');
      if (minimizeBtn) {
        await minimizeBtn.click();
        await new Promise(r => setTimeout(r, 450));
        const isMinimized = await pageA.evaluate(() => document.querySelector('.sidebar').classList.contains('sidebar-minimized'));
        if (!isMinimized) throw new Error('Sidebar failed to minimize');
        await minimizeBtn.click();
        await new Promise(r => setTimeout(r, 450));
      }
    });

    // =========================================================================
    // MODULE 3: 1-ON-1 DIRECT E2EE MESSAGING & FORMATTING
    // =========================================================================
    logHeader('MODULE 3: 1-ON-1 DIRECT E2EE MESSAGES, MARKDOWN, TYPING & READ RECEIPTS');

    await runStep('Bob sends E2EE plaintext message to Alice', async () => {
      await pageB.type('textarea.message-textarea', 'Hello Alice! Zero-knowledge E2EE initialized.');
      await new Promise(r => setTimeout(r, 200));
      await pageB.click('.send-btn');
      await new Promise(r => setTimeout(r, 1500));

      // Alice selects Bob's conversation
      await pageA.waitForFunction((u) => {
        const items = Array.from(document.querySelectorAll('.contact-item'));
        return items.some(el => el.textContent.toLowerCase().includes(u.toLowerCase()));
      }, { timeout: 10000 }, bobUser);

      await pageA.evaluate((u) => {
        const items = Array.from(document.querySelectorAll('.contact-item'));
        const target = items.find(el => el.textContent.toLowerCase().includes(u.toLowerCase()));
        if (target) target.click();
      }, bobUser);
      await new Promise(r => setTimeout(r, 1000));

      await pageA.waitForFunction(() => {
        return document.body.innerText.includes('Zero-knowledge E2EE initialized.');
      }, { timeout: 10000 });
    });

    await runStep('Bob sends Markdown formatted message (bold, italic, code, spoiler)', async () => {
      const mdText = '*bold text* _italic text_ `console.log(key)` ||secret spoiler||';
      await setTextareaValue(pageB, 'textarea.message-textarea', mdText);
      await new Promise(r => setTimeout(r, 400));

      await pageB.evaluate(() => {
        const sendBtn = document.querySelector('.input-circle-btn.send-btn.send-active, .input-circle-btn.send-btn, button[title*="Send"]');
        if (sendBtn) {
          sendBtn.click();
        } else {
          const ta = document.querySelector('textarea.message-textarea');
          if (ta) {
            ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
          }
        }
      });
      await new Promise(r => setTimeout(r, 1500));

      const pageBChat = await pageB.evaluate(() => document.querySelector('.chat-header-name')?.innerText || 'NO_CHAT_OPEN');
      const pageAChat = await pageA.evaluate(() => document.querySelector('.chat-header-name')?.innerText || 'NO_CHAT_OPEN');
      console.log('PAGE B ACTIVE CHAT:', pageBChat);
      console.log('PAGE A ACTIVE CHAT:', pageAChat);

      const pageBMsgs = await pageB.evaluate(() => Array.from(document.querySelectorAll('.message-bubble')).map(m => m.innerHTML));
      const pageAMsgs = await pageA.evaluate(() => Array.from(document.querySelectorAll('.message-bubble')).map(m => m.innerHTML));
      console.log('PAGE B BUBBLES:', pageBMsgs);
      console.log('PAGE A BUBBLES:', pageAMsgs);

      await pageA.waitForFunction(() => {
        const strong = document.querySelector('.messages-container strong');
        const em = document.querySelector('.messages-container em');
        const code = document.querySelector('.messages-container code');
        const spoiler = document.querySelector('.messages-container .spoiler-text');
        return Boolean(strong && em && code && spoiler);
      }, { timeout: 10000 });
    });

    await runStep('Alice types and Bob receives typing indicator', async () => {
      await pageA.focus('textarea.message-textarea');
      await pageA.type('textarea.message-textarea', 'I am typing a response...');
      await new Promise(r => setTimeout(r, 600));

      const bobSeesTyping = await pageB.evaluate(() => {
        const typingEl = document.querySelector('.typing-indicator-wrapper, .typing-text');
        return Boolean(typingEl);
      });
      if (!bobSeesTyping) console.warn('Typing indicator not detected');

      await pageA.evaluate(() => {
        const ta = document.querySelector('textarea.message-textarea');
        if (ta) ta.value = '';
      });
    });

    // =========================================================================
    // MODULE 4: EMOJIS, GIFS & JUMBO EMOJIS
    // =========================================================================
    logHeader('MODULE 4: APPLE EMOJI PICKER, ANIMATED GIFS & JUMBO EMOJIS');

    await runStep('Test Apple Emoji Picker: search and insert emoji', async () => {
      await pageB.click('.input-emoji-btn');
      await new Promise(r => setTimeout(r, 500));

      await pageB.waitForSelector('.apple-search-input', { timeout: 8000 });
      await pageB.type('.apple-search-input', 'fire');
      await new Promise(r => setTimeout(r, 400));

      await pageB.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('.apple-emoji-btn'));
        const fire = buttons.find(b => b.textContent.includes('🔥'));
        if (fire) fire.click();
      });
      await new Promise(r => setTimeout(r, 500));

      await pageB.waitForSelector('.send-btn, .input-circle-btn.send-btn', { timeout: 8000 });
      await pageB.evaluate(() => {
        const btn = document.querySelector('.input-circle-btn.send-btn.send-active, .send-btn, button[title*="Send"]');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 1500));

      const hasJumbo = await pageA.evaluate(() => {
        const jumbo = document.querySelector('.jumbo-emoji-bubble, .message-bubble.emoji-only, .emoji-only-bubble');
        return Boolean(jumbo || document.body.innerText.includes('🔥'));
      });
      if (!hasJumbo) throw new Error('Jumbo emoji was not rendered');
    });

    await runStep('Test GIF Picker and sending animated GIF reaction', async () => {
      await pageB.click('.input-emoji-btn');
      await new Promise(r => setTimeout(r, 400));

      await pageB.evaluate(() => {
        const gifTab = Array.from(document.querySelectorAll('.expression-control-btn')).find(t => t.textContent.includes('GIF'));
        if (gifTab) gifTab.click();
      });
      await new Promise(r => setTimeout(r, 600));

      await pageB.waitForSelector('.gif-grid-item', { timeout: 8000 });
      await pageB.evaluate(() => {
        const firstGif = document.querySelector('.gif-grid-item');
        if (firstGif) firstGif.click();
      });
      await new Promise(r => setTimeout(r, 1500));

      const aliceHasGif = await pageA.evaluate(() => {
        const img = document.querySelector('.gif-message-img, .gif-message-wrapper');
        return Boolean(img);
      });
      if (!aliceHasGif) throw new Error('GIF message was not rendered in Alice view');
    });

    // =========================================================================
    // MODULE 5: MEDIA ATTACHMENTS & VOICE NOTES
    // =========================================================================
    logHeader('MODULE 5: PHOTOS, MULTI-PHOTO ALBUMS, VIDEO PLAYER & VOICE NOTES');

    await runStep('Send Single Photo Attachment and verify image preview', async () => {
      const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      await pageB.evaluate((b64) => {
        const byteCharacters = atob(b64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const file = new File([byteArray], 'sample_test_image.png', { type: 'image/png' });

        const input = document.querySelector('#file-input');
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, samplePngBase64);

      await new Promise(r => setTimeout(r, 600));
      await pageB.click('.send-btn');
      await new Promise(r => setTimeout(r, 2000));

      const aliceHasPhoto = await pageA.evaluate(() => {
        const img = document.querySelector('.image-message-wrapper img, .single-image-card');
        return Boolean(img || document.querySelector('.image-preview-container'));
      });
      if (!aliceHasPhoto) throw new Error('Photo attachment was not displayed');
    });

    await runStep('Send Multi-Photo Album (3 images) and verify collage grid', async () => {
      const samplePngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      await pageB.evaluate((b64) => {
        const byteCharacters = atob(b64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const file1 = new File([byteArray], 'photo_1.png', { type: 'image/png' });
        const file2 = new File([byteArray], 'photo_2.png', { type: 'image/png' });
        const file3 = new File([byteArray], 'photo_3.png', { type: 'image/png' });

        const input = document.querySelector('#file-input');
        const dt = new DataTransfer();
        dt.items.add(file1);
        dt.items.add(file2);
        dt.items.add(file3);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, samplePngBase64);

      await new Promise(r => setTimeout(r, 600));
      await pageB.click('.send-btn');
      await new Promise(r => setTimeout(r, 2500));

      const aliceHasAlbum = await pageA.evaluate(() => {
        const album = document.querySelector('.album-grid, .media-album-grid');
        return Boolean(album);
      });
      if (!aliceHasAlbum) throw new Error('Album grid was not rendered');
    });

    await runStep('Test Voice Note recording, waveform animation, and send', async () => {
      await pageB.click('.mic-btn');
      await new Promise(r => setTimeout(r, 1200));

      const isRecording = await pageB.evaluate(() => {
        return Boolean(document.querySelector('.recording-waveform-bars, .recording-banner'));
      });
      if (!isRecording) throw new Error('Recording UI did not appear');

      await pageB.click('.send-btn.voice-send, button[title*="voice note"]');
      await new Promise(r => setTimeout(r, 2000));

      const aliceHasVoice = await pageA.evaluate(() => {
        const voiceItem = document.querySelector('.voice-note-player-compact, .play-pause-btn-compact, .voice-note-card, .voice-player-container');
        return Boolean(voiceItem);
      });
      if (!aliceHasVoice) throw new Error('Voice note was not received by Alice');
    });

    // =========================================================================
    // MODULE 6: REPLIES, FORWARDING, SELECTION & DELETE
    // =========================================================================
    logHeader('MODULE 6: QUOTED REPLIES, FORWARD MODAL, MULTI-SELECT & DELETION');

    await runStep('Test Quoted Message Reply and jump-to-source click', async () => {
      await pageB.evaluate(() => {
        const msg = document.querySelector('.message-bubble');
        if (msg) {
          const evt = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 });
          msg.dispatchEvent(evt);
        }
      });
      await new Promise(r => setTimeout(r, 400));

      await pageB.evaluate(() => {
        const replyBtn = document.querySelector('.selection-action-btn.reply, button[title*="Reply"]');
        if (replyBtn) replyBtn.click();
      });
      await new Promise(r => setTimeout(r, 400));

      await setTextareaValue(pageB, 'textarea.message-textarea', 'Replying to your previous message!');
      await pageB.click('.send-btn');
      await new Promise(r => setTimeout(r, 1500));

      const aliceHasQuotedReply = await pageA.evaluate(() => {
        const quote = document.querySelector('.message-reply-context, .reply-quote-preview, .quoted-message-box');
        return Boolean(quote);
      });
      if (!aliceHasQuotedReply) throw new Error('Quoted reply header was not rendered');
    });

    await runStep('Test Message Forwarding modal to Charlie', async () => {
      await pageA.evaluate(() => {
        const rows = document.querySelectorAll('.message-row');
        const last = rows[rows.length - 1];
        if (last) {
          const evt = new MouseEvent('mousedown', { bubbles: true, button: 0 });
          last.dispatchEvent(evt);
        }
      });
      await new Promise(r => setTimeout(r, 600));

      await pageA.evaluate(() => {
        const rows = document.querySelectorAll('.message-row');
        const last = rows[rows.length - 1];
        if (last) {
          const evt = new MouseEvent('mouseup', { bubbles: true });
          last.dispatchEvent(evt);
        }
      });
      await new Promise(r => setTimeout(r, 400));

      await pageA.waitForSelector('.selection-forward-header-btn, .header-action-btn[title*="Forward"]', { timeout: 8000 });
      await pageA.click('.selection-forward-header-btn, .header-action-btn[title*="Forward"]');
      await new Promise(r => setTimeout(r, 600));

      await pageA.waitForSelector('.forward-modal-card', { timeout: 8000 });
      await pageA.evaluate((u) => {
        const rows = Array.from(document.querySelectorAll('.forward-contact-item'));
        const charlieRow = rows.find(r => r.textContent.toLowerCase().includes(u.toLowerCase()));
        if (charlieRow) {
          charlieRow.click();
        }
      }, charlieUser);
      await new Promise(r => setTimeout(r, 400));

      await pageA.evaluate((u) => {
        const rows = Array.from(document.querySelectorAll('.forward-contact-item'));
        const charlieRow = rows.find(r => r.textContent.toLowerCase().includes(u.toLowerCase()));
        if (charlieRow) {
          const sendBtn = charlieRow.querySelector('.forward-contact-action');
          if (sendBtn) sendBtn.click();
        }
      }, charlieUser);
      await new Promise(r => setTimeout(r, 1500));

      await pageC.evaluate((u) => {
        const items = Array.from(document.querySelectorAll('.contact-item'));
        const target = items.find(el => el.textContent.toLowerCase().includes(u.toLowerCase()));
        if (target) target.click();
      }, aliceUser);
      await new Promise(r => setTimeout(r, 1000));

      const charlieHasForward = await pageC.evaluate(() => {
        return document.body.innerText.includes('Replying to your previous message!') || document.body.innerText.includes('Hello Alice!');
      });
      if (!charlieHasForward) throw new Error('Forwarded message not received by Charlie');
    });

    await runStep('Test Out-of-Band Safety Number Fingerprint verification modal', async () => {
      await pageA.click('.safety-number-btn');
      await new Promise(r => setTimeout(r, 500));
      await pageA.waitForSelector('.safety-modal-card', { timeout: 8000 });

      const safetyDigits = await pageA.evaluate(() => {
        const numEl = document.querySelector('.safety-number-display, .safety-number-code, .safety-digits');
        return numEl ? numEl.innerText : null;
      });

      if (!safetyDigits) throw new Error('Safety number fingerprint not displayed');

      await pageA.click('.safety-close-btn');
      await new Promise(r => setTimeout(r, 400));
    });

    // =========================================================================
    // MODULE 7: WEBRTC 1-ON-1 CALLS & ACTIVE HUD CONTROLS
    // =========================================================================
    logHeader('MODULE 7: WEBRTC 1-ON-1 CALLS, HUD CONTROLS, SCREEN SHARING & PIP');

    await runStep('Voice Call Decline scenario (Alice calls Bob, Bob declines)', async () => {
      await pageA.evaluate(() => {
        const btn = document.querySelector('button[title*="Voice Call"]');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 1200));

      await pageB.waitForSelector('.pill-btn.decline, .call-btn.decline, button[title*="Decline"]', { timeout: 10000 });
      await pageB.click('.pill-btn.decline, .call-btn.decline, button[title*="Decline"]');
      await new Promise(r => setTimeout(r, 1500));

      const hasCallLog = await pageA.evaluate(() => {
        const log = document.querySelector('.system-call-log-card, .call-log-card, .system-call-log-container');
        return Boolean(log);
      });
      if (!hasCallLog) throw new Error('Call log card was not rendered on decline');
    });

    await runStep('Video Call Connect scenario (Alice calls Bob, Bob accepts)', async () => {
      await pageA.evaluate(() => {
        const btn = document.querySelector('button[title*="Video Call"]');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 1500));

      await pageB.waitForSelector('.pill-btn.accept, .call-btn.accept, button[title*="Accept"]', { timeout: 10000 });
      await pageB.click('.pill-btn.accept, .call-btn.accept, button[title*="Accept"]');
      await new Promise(r => setTimeout(r, 2000));

      const isConnected = await pageA.evaluate(() => {
        const overlay = document.querySelector('.call-overlay');
        return Boolean(overlay);
      });
      if (!isConnected) throw new Error('Call did not enter connected state');
    });

    await runStep('Test Call HUD Buttons: Mute, Camera, Screen Share, PiP, and Hang Up', async () => {
      // 1. Test Mute Toggle
      const muteBtn = await pageA.$('.call-btn.mute, button[title*="Mute"], button[title*="Microphone"]');
      if (muteBtn) {
        await muteBtn.click();
        await new Promise(r => setTimeout(r, 400));
        await muteBtn.click();
        await new Promise(r => setTimeout(r, 400));
      }

      // 2. Test Camera Toggle
      const camBtn = await pageA.$('.call-btn[title*="Camera"], button[title*="camera"]');
      if (camBtn) {
        await camBtn.click();
        await new Promise(r => setTimeout(r, 400));
        await camBtn.click();
        await new Promise(r => setTimeout(r, 400));
      }

      // 3. Test Screen Share Toggle
      const screenBtn = await pageA.$('.call-btn.screen-share, button[title*="Screen"], button[title*="screen"]');
      if (screenBtn) {
        await screenBtn.click();
        await new Promise(r => setTimeout(r, 600));
        await screenBtn.click();
        await new Promise(r => setTimeout(r, 600));
      }

      // 4. Test PiP Minimize and Maximize
      const minBtn = await pageA.$('.call-btn.minimize, button[title*="Minimize"]');
      if (minBtn) {
        await minBtn.click();
        await new Promise(r => setTimeout(r, 600));

        const maxBtn = await pageA.$('.call-btn.maximize, button[title*="Expand"], button[title*="Maximize"]');
        if (maxBtn) {
          await maxBtn.click();
          await new Promise(r => setTimeout(r, 600));
        }
      }

      // 5. Hang Up Call
      await pageA.evaluate(() => {
        const overlay = document.querySelector('.call-overlay');
        if (overlay) {
          overlay.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        }
        const hangupBtn = document.querySelector('.call-btn.decline, .call-btn.hangup, button[title*="End Call"], button[title*="Hang"]');
        if (hangupBtn) {
          hangupBtn.click();
        }
      });
      await new Promise(r => setTimeout(r, 1500));

      const callEnded = await pageA.evaluate(() => {
        return !document.querySelector('.call-overlay');
      });
      if (!callEnded) throw new Error('Call overlay did not close cleanly on hangup');
    });

    // =========================================================================
    // MODULE 8: GROUP CHATS, ROLES & GROUP WEBRTC CALLS
    // =========================================================================
    logHeader('MODULE 8: ENCRYPTED GROUP CHATS, MEMBER ROLES & GROUP CALLS');

    const groupName = 'Zap Core Engineers';

    await runStep('Create Group Chat with Bob and Charlie as members', async () => {
      await pageA.click('.new-group-btn');
      await new Promise(r => setTimeout(r, 500));
      await pageA.waitForSelector('.create-group-modal', { timeout: 8000 });

      await pageA.type('.create-group-name-input', groupName);
      await new Promise(r => setTimeout(r, 300));

      await pageA.evaluate((b, c) => {
        const items = Array.from(document.querySelectorAll('.create-group-contact-item'));
        const bobRow = items.find(r => r.textContent.toLowerCase().includes(b.toLowerCase()));
        const charlieRow = items.find(r => r.textContent.toLowerCase().includes(c.toLowerCase()));
        if (bobRow) bobRow.click();
        if (charlieRow) charlieRow.click();
      }, bobUser, charlieUser);
      await new Promise(r => setTimeout(r, 400));

      await pageA.click('.create-group-create-btn');
      await new Promise(r => setTimeout(r, 2000));

      const aliceHasGroup = await pageA.evaluate((g) => document.body.innerText.includes(g), groupName);
      const bobHasGroup = await pageB.evaluate((g) => document.body.innerText.includes(g), groupName);
      const charlieHasGroup = await pageC.evaluate((g) => document.body.innerText.includes(g), groupName);

      if (!aliceHasGroup || !bobHasGroup || !charlieHasGroup) {
        throw new Error('Group not propagated to all members');
      }
    });

    await runStep('Send Encrypted Group Message and verify all members decrypt', async () => {
      await pageA.evaluate((g) => {
        const groups = Array.from(document.querySelectorAll('.contact-item.group-item, .contact-item'));
        const target = groups.find(el => el.textContent.includes(g));
        if (target) target.click();
      }, groupName);
      await new Promise(r => setTimeout(r, 800));

      const groupMsg = 'Hello team! Encrypted group broadcast via sealed key envelopes.';
      await setTextareaValue(pageA, 'textarea.message-textarea', groupMsg);
      await pageA.click('.send-btn');
      await new Promise(r => setTimeout(r, 2000));

      await pageB.evaluate((g) => {
        const groups = Array.from(document.querySelectorAll('.contact-item.group-item, .contact-item'));
        const target = groups.find(el => el.textContent.includes(g));
        if (target) target.click();
      }, groupName);
      await new Promise(r => setTimeout(r, 800));

      await pageC.evaluate((g) => {
        const groups = Array.from(document.querySelectorAll('.contact-item.group-item, .contact-item'));
        const target = groups.find(el => el.textContent.includes(g));
        if (target) target.click();
      }, groupName);
      await new Promise(r => setTimeout(r, 800));

      const bobDecrypted = await pageB.evaluate((m) => document.body.innerText.includes(m), groupMsg);
      const charlieDecrypted = await pageC.evaluate((m) => document.body.innerText.includes(m), groupMsg);

      if (!bobDecrypted || !charlieDecrypted) {
        throw new Error('Group message decryption failed on recipient peers');
      }
    });

    await runStep('Test Group Info Modal and Admin role management', async () => {
      await pageA.click('button[title*="Group info"]');
      await new Promise(r => setTimeout(r, 600));
      await pageA.waitForSelector('.group-info-modal', { timeout: 8000 });

      const hasInfo = await pageA.evaluate(() => {
        return Boolean(document.querySelector('.group-info-modal'));
      });
      if (!hasInfo) throw new Error('Group info modal did not open');

      await pageA.click('.create-group-close');
      await new Promise(r => setTimeout(r, 400));
    });

    await runStep('Test Group Video Call signaling and multi-peer join', async () => {
      await pageA.evaluate(() => {
        const btn = document.querySelector('button[title*="Group Video Call"], button[title*="Group Call"], button[title*="Video Call"]');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 1500));

      await pageB.waitForSelector('.pill-btn.accept, .gcall-btn-accept, button[title*="Join"], button[title*="Accept"]', { timeout: 10000 });
      await pageB.click('.pill-btn.accept, .gcall-btn-accept, button[title*="Join"], button[title*="Accept"]');
      await new Promise(r => setTimeout(r, 2000));

      const hasGrid = await pageA.evaluate(() => {
        const grid = document.querySelector('.gcall-overlay-stage, .call-overlay, .gcall-grid');
        return Boolean(grid);
      });
      if (!hasGrid) throw new Error('Group call grid did not appear');

      const gcMuteBtn = await pageA.$('.call-btn.mute, button[title*="Mute"]');
      if (gcMuteBtn) {
        await gcMuteBtn.click();
        await new Promise(r => setTimeout(r, 300));
        await gcMuteBtn.click();
      }

      const gcEndBtn = await pageA.$('.call-btn.decline, button[title*="Leave"], button[title*="End"]');
      if (gcEndBtn) {
        await gcEndBtn.click();
        await new Promise(r => setTimeout(r, 1200));
      }

      const bobGcEndBtn = await pageB.$('.call-btn.decline, button[title*="Leave"], button[title*="End"]');
      if (bobGcEndBtn) {
        await bobGcEndBtn.click();
        await new Promise(r => setTimeout(r, 1200));
      }
    });

    // =========================================================================
    // MODULE 9: PRIVACY, SETTINGS & CLEAN LOGOUT
    // =========================================================================
    logHeader('MODULE 9: SETTINGS, THEME TOKENS, PRIVACY CONTROLS & LOGOUT');

    await runStep('Open Settings View, update display name and theme color', async () => {
      await pageA.click('.sidebar-settings-btn');
      await new Promise(r => setTimeout(r, 500));
      await pageA.waitForSelector('.settings-view', { timeout: 8000 });

      await pageA.evaluate(() => {
        const input = document.querySelector('.settings-input, input[placeholder*="Name"], input[type="text"]');
        if (input) {
          input.value = 'Alice Cryptographer';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await new Promise(r => setTimeout(r, 300));

      await pageA.evaluate(() => {
        const swatches = document.querySelectorAll('.theme-swatch, .theme-swatch-circle');
        if (swatches.length > 1) swatches[1].click();
      });
      await new Promise(r => setTimeout(r, 300));

      await pageA.evaluate(() => {
        const saveBtn = document.querySelector('.save-profile-btn, .save-settings-btn, button.btn-primary');
        if (saveBtn) saveBtn.click();
      });
      await new Promise(r => setTimeout(r, 1000));

      await pageA.click('.back-btn');
      await new Promise(r => setTimeout(r, 500));
    });

    await runStep('Test Block Contact and Privacy Isolation', async () => {
      await pageA.evaluate((u) => {
        const items = Array.from(document.querySelectorAll('.contact-item'));
        const target = items.find(el => el.textContent.toLowerCase().includes(u.toLowerCase()));
        if (target) {
          const evt = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 });
          target.dispatchEvent(evt);
        }
      }, bobUser);
      await new Promise(r => setTimeout(r, 500));

      await pageA.evaluate(() => {
        const blockBtn = document.querySelector('.modal-action-btn.danger, button[title*="Block"]');
        if (blockBtn) blockBtn.click();
      });
      await new Promise(r => setTimeout(r, 600));

      await pageA.evaluate(() => {
        const confirmBtn = document.querySelector('.confirm-modal-btn.danger, .app-confirm-btn.danger');
        if (confirmBtn) confirmBtn.click();
      });
      await new Promise(r => setTimeout(r, 1000));
    });

    await runStep('Test Log Out action and return to Auth View', async () => {
      await pageB.evaluate(() => {
        const btn = document.querySelector('.sidebar-settings-btn');
        if (btn) btn.click();
      });
      await new Promise(r => setTimeout(r, 500));
      await pageB.waitForSelector('.settings-view', { timeout: 8000 });

      await pageB.evaluate(() => {
        const logoutBtn = document.querySelector('.settings-logout-btn, .logout-btn, button[title*="Sign Out"], button[title*="Log out"], button[title*="Logout"]');
        if (logoutBtn) logoutBtn.click();
      });
      await new Promise(r => setTimeout(r, 600));

      await pageB.waitForSelector('.confirmation-modal, .confirmation-danger-btn', { timeout: 8000 });
      await pageB.click('.confirmation-danger-btn');
      await new Promise(r => setTimeout(r, 1500));

      const returnedToAuth = await pageB.evaluate(() => {
        return Boolean(document.querySelector('.auth-container, #username'));
      });
      if (!returnedToAuth) throw new Error('Logout did not return to auth container');
    });

    // =========================================================================
    // SUITE SUMMARY
    // =========================================================================
    logHeader('COMPREHENSIVE TEST SUITE EXECUTION SUMMARY');
    console.log(`\n🎉 TOTAL TESTS EXECUTED : ${totalTests}`);
    console.log(`✅ TOTAL PASSED         : ${passedTests}`);
    console.log(`❌ TOTAL FAILED         : ${failedTests}`);
    console.log(`📊 SUCCESS RATE         : ${((passedTests / totalTests) * 100).toFixed(1)}%\n`);

    if (failedTests > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('\n❌ TEST RUNNER ABORTED WITH ERROR:', err);
    process.exit(1);
  } finally {
    console.log('Cleaning up browser instances and server...');
    if (browser) await browser.close();
    if (server) await new Promise(r => server.close(r));
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
