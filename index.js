const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  delay,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const {
  KEYWORD_REPLIES,
  MEDIA_REPLIES,
  DEFAULT_REPLY,
  BUSINESS_NAME,
  MEDIA_DIR,
  ADMIN_NUMBERS,
} = require('./config');

// ─── State ───────────────────────────────────────────────
const SESSION_DIR = path.join(__dirname, 'session');
const logger = pino({ level: 'silent' });
let botEnabled = true; // toggle with /stop and /start
let sock = null;

// ─── Helpers ─────────────────────────────────────────────

// Find best matching keyword from user message
function findBestReply(userMessage) {
  const msg = userMessage.toLowerCase().trim();

  // Exact match first
  for (const [keyword, reply] of Object.entries(KEYWORD_REPLIES)) {
    if (msg === keyword) return { text: reply };
  }

  // Partial match — longest keyword wins
  let bestMatch = null;
  let bestLength = 0;

  for (const [keyword, reply] of Object.entries(KEYWORD_REPLIES)) {
    if (msg.includes(keyword) && keyword.length > bestLength) {
      bestMatch = { text: reply };
      bestLength = keyword.length;
    }
  }

  return bestMatch;
}

// Check for media reply
function findMediaReply(userMessage) {
  const msg = userMessage.toLowerCase().trim();
  for (const [keyword, media] of Object.entries(MEDIA_REPLIES)) {
    if (msg.includes(keyword)) {
      const filePath = path.join(MEDIA_DIR, media.file);
      if (fs.existsSync(filePath)) {
        return { filePath, caption: media.caption || '' };
      }
    }
  }
  return null;
}

// Should we reply?
function shouldReply(msg) {
  const chatId = msg.key.remoteJid;
  if (msg.key.fromMe) return false;
  if (chatId.endsWith('@g.us')) return process.env.REPLY_IN_GROUPS === 'true';
  if (chatId.endsWith('@broadcast')) return false;
  if (chatId === 'status@broadcast') return false;
  return true;
}

// Extract text from message
function getMessageText(msg) {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    null
  );
}

// Check if sender is admin
function isAdmin(msg) {
  const phone = msg.key.remoteJid.replace(/@s\.whatsapp\.net$/, '');
  return ADMIN_NUMBERS.includes(phone);
}

// Split message into chunks (max ~4000 chars each for WhatsApp)
function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at last newline before maxLen
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

// Send reply with typing indicator + media support + pagination
async function sendReply(chatId, replyObj) {
  // Handle text reply (with optional media)
  if (replyObj.text) {
    const chunks = splitMessage(replyObj.text);
    for (let i = 0; i < chunks.length; i++) {
      // Show typing indicator
      await sock.sendPresenceUpdate('composing', chatId);
      await delay(800 + Math.random() * 1200); // 0.8–2s realistic delay

      await sock.sendMessage(chatId, { text: chunks[i] });

      // Pause between chunks
      if (i < chunks.length - 1) {
        await delay(500);
      }
    }
    await sock.sendPresenceUpdate('paused', chatId);
  }

  // Handle media reply
  if (replyObj.filePath) {
    await sock.sendPresenceUpdate('composing', chatId);
    await delay(1000);

    const ext = path.extname(replyObj.filePath).toLowerCase();
    const buffer = fs.readFileSync(replyObj.filePath);

    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      await sock.sendMessage(chatId, {
        image: buffer,
        caption: replyObj.caption || '',
      });
    } else if (['.mp4', '.mov'].includes(ext)) {
      await sock.sendMessage(chatId, {
        video: buffer,
        caption: replyObj.caption || '',
      });
    } else {
      await sock.sendMessage(chatId, {
        document: buffer,
        fileName: path.basename(replyObj.filePath),
        caption: replyObj.caption || '',
      });
    }

    await sock.sendPresenceUpdate('paused', chatId);
  }
}

// ─── Main Connection ─────────────────────────────────────
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    browser: ['WhatsApp Auto Bot', 'Chrome', '4.0.0'],
  });

  // Save credentials on update
  sock.ev.on('creds.update', saveCreds);

  // Use pairing code instead of QR (no scan needed)
  // Only request pairing code if not already logged in
  if (!state.creds.registered) {
    const pairingCode = await sock.requestPairingCode(process.env.BUSINESS_PHONE || '918555874504');
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║   LINK YOUR WHATSAPP WITH THIS CODE  ║');
    console.log('╚══════════════════════════════════════╝');
    console.log(`\n  📱 Your pairing code: ${pairingCode}\n`);
    console.log('  How to link:');
    console.log('  1. Open WhatsApp on your phone');
    console.log('  2. Go to Settings → Linked Devices');
    console.log('  3. Tap "Link a Device"');
    console.log('  4. Tap "Link with phone number instead"');
    console.log(`  5. Enter the code: ${pairingCode}`);
    console.log('\n  Waiting for you to enter the code...\n');
  }

  // Connection events
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(`\n⚠️  Connection closed. Reason: ${reason}`);

      if (reason === DisconnectReason.loggedOut) {
        console.log('❌ Logged out. Delete session/ folder and restart.');
        process.exit(1);
      }
      console.log('🔄 Reconnecting in 3s...');
      setTimeout(() => connectToWhatsApp(), 3000);
    }

    if (connection === 'open') {
      console.log('✅ Connected to WhatsApp!');
      console.log(`🤖 ${BUSINESS_NAME} Auto-Reply Bot is running!`);
      console.log('💬 Waiting for incoming messages...\n');
      console.log('Admin commands: /stop (pause bot) | /start (resume bot) | /status (check status)');
      console.log('Press Ctrl+C to stop.\n');
    }
  });

  // ─── Message Handler ───────────────────────────────────
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!shouldReply(msg)) continue;

      const text = getMessageText(msg);
      if (!text) continue;

      const chatId = msg.key.remoteJid;
      const senderName = msg.pushName || 'Unknown';

      console.log(`📩 [${new Date().toLocaleTimeString()}] ${senderName}: ${text}`);

      // ── Admin Commands ─────────────────────────────────
      const cmd = text.trim().toLowerCase();

      if (cmd === '/stop' && isAdmin(msg)) {
        botEnabled = false;
        await sock.sendMessage(chatId, { text: '🛑 Bot paused. Send /start to resume.' });
        console.log(`🛑 Bot paused by admin ${senderName}`);
        continue;
      }

      if (cmd === '/start' && isAdmin(msg)) {
        botEnabled = true;
        await sock.sendMessage(chatId, { text: '✅ Bot resumed! Auto-replies are active.' });
        console.log(`✅ Bot resumed by admin ${senderName}`);
        continue;
      }

      if (cmd === '/status' && isAdmin(msg)) {
        const statusText = `📊 *Bot Status*\n\n• Status: ${botEnabled ? '🟢 Running' : '🔴 Paused'}\n• Keywords: ${Object.keys(KEYWORD_REPLIES).length}\n• Uptime: ${Math.floor(process.uptime() / 60)}m ${Math.floor(process.uptime() % 60)}s`;
        await sock.sendMessage(chatId, { text: statusText });
        continue;
      }

      // Skip if bot is paused
      if (!botEnabled) continue;

      // ── Find Reply ─────────────────────────────────────
      // Check for media reply first
      const mediaReply = findMediaReply(text);
      if (mediaReply) {
        await sendReply(chatId, { text: null, ...mediaReply });
        console.log(`✅ [${new Date().toLocaleTimeString()}] Sent media to ${senderName}`);
        continue;
      }

      // Text reply
      const replyObj = findBestReply(text);
      const replyText = replyObj ? replyObj.text : DEFAULT_REPLY;

      try {
        await sendReply(chatId, { text: replyText });
        console.log(`✅ [${new Date().toLocaleTimeString()}] Replied to ${senderName}`);
      } catch (err) {
        console.error(`❌ Failed to reply to ${senderName}:`, err.message);
      }
    }
  });

  return sock;
}

// ─── Process Handlers ────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down bot...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
});

// ─── Start ───────────────────────────────────────────────
console.log('🚀 Starting WhatsApp Auto-Reply Bot...\n');

// Ensure media directory exists
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  console.log('📁 Created media/ folder — place images/docs here for media replies.\n');
}

connectToWhatsApp().catch((err) => {
  console.error('❌ Failed to start bot:', err);
  process.exit(1);
});
