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

const SESSION_DIR = path.join(__dirname, 'session');
const logger = pino({ level: 'silent' });
let botEnabled = true;
let sock = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 50;

function findBestReply(userMessage) {
  const msg = userMessage.toLowerCase().trim();
  for (const [keyword, reply] of Object.entries(KEYWORD_REPLIES)) {
    if (msg === keyword) return { text: reply };
  }
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

function findMediaReply(userMessage) {
  const msg = userMessage.toLowerCase().trim();
  for (const [keyword, media] of Object.entries(MEDIA_REPLIES)) {
    if (msg.includes(keyword)) {
      const filePath = path.join(MEDIA_DIR, media.file);
      if (fs.existsSync(filePath)) return { filePath, caption: media.caption || '' };
    }
  }
  return null;
}

function shouldReply(msg) {
  const chatId = msg.key.remoteJid;
  if (msg.key.fromMe) return false;
  if (chatId.endsWith('@g.us')) return process.env.REPLY_IN_GROUPS === 'true';
  if (chatId.endsWith('@broadcast')) return false;
  if (chatId === 'status@broadcast') return false;
  return true;
}

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

function isAdmin(msg) {
  const phone = msg.key.remoteJid.replace(/@s\.whatsapp\.net$/, '');
  return ADMIN_NUMBERS.includes(phone);
}

function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

async function sendReply(chatId, replyObj) {
  try {
    if (replyObj.text) {
      const chunks = splitMessage(replyObj.text);
      for (let i = 0; i < chunks.length; i++) {
        await sock.sendPresenceUpdate('composing', chatId).catch(() => {});
        await delay(800 + Math.random() * 1200);
        await sock.sendMessage(chatId, { text: chunks[i] });
        if (i < chunks.length - 1) await delay(500);
      }
      await sock.sendPresenceUpdate('paused', chatId).catch(() => {});
    }
    if (replyObj.filePath && fs.existsSync(replyObj.filePath)) {
      await sock.sendPresenceUpdate('composing', chatId).catch(() => {});
      await delay(1000);
      const ext = path.extname(replyObj.filePath).toLowerCase();
      const buffer = fs.readFileSync(replyObj.filePath);
      if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
        await sock.sendMessage(chatId, { image: buffer, caption: replyObj.caption || '' });
      } else if (['.mp4', '.mov'].includes(ext)) {
        await sock.sendMessage(chatId, { video: buffer, caption: replyObj.caption || '' });
      } else {
        await sock.sendMessage(chatId, { document: buffer, fileName: path.basename(replyObj.filePath), caption: replyObj.caption || '' });
      }
      await sock.sendPresenceUpdate('paused', chatId).catch(() => {});
    }
  } catch (err) {
    console.error('Send error:', err.message);
  }
}

async function connectToWhatsApp() {
  if (reconnectAttempts >= MAX_RECONNECT) {
    console.log('Too many reconnect attempts. Stopping.');
    process.exit(1);
  }

  try {
    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

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
      browser: ['Firefox', 'Chrome', '120.0'],
      connectTimeout: 60000,
      keepAliveIntervalMs: 25000,
      markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n--- SCAN THIS QR CODE WITH YOUR PHONE ---\n');
        qrcode.generate(qr, { small: true });
        console.log('\nOpen WhatsApp > Linked Devices > Link a Device\n');
      }

      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log('Connection closed. Reason:', reason);

        if (reason === DisconnectReason.loggedOut) {
          console.log('Logged out. Restarting fresh...');
          try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch (e) {}
          reconnectAttempts = 0;
          setTimeout(() => connectToWhatsApp(), 3000);
        } else {
          reconnectAttempts++;
          const waitTime = Math.min(reconnectAttempts * 2000, 30000);
          console.log('Reconnecting in ' + (waitTime / 1000) + 's (attempt ' + reconnectAttempts + ')...');
          setTimeout(() => connectToWhatsApp(), waitTime);
        }
      }

      if (connection === 'open') {
        reconnectAttempts = 0;
        console.log('Connected to WhatsApp!');
        console.log(BUSINESS_NAME + ' bot is running!');
        console.log('Commands: /stop | /start | /status\n');
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          if (!shouldReply(msg)) continue;
          const text = getMessageText(msg);
          if (!text) continue;
          const chatId = msg.key.remoteJid;
          const senderName = msg.pushName || 'Unknown';
          console.log('[' + new Date().toLocaleTimeString() + '] ' + senderName + ': ' + text);

          const cmd = text.trim().toLowerCase();
          if (cmd === '/stop' && isAdmin(msg)) { botEnabled = false; await sock.sendMessage(chatId, { text: 'Bot paused.' }); continue; }
          if (cmd === '/start' && isAdmin(msg)) { botEnabled = true; await sock.sendMessage(chatId, { text: 'Bot resumed!' }); continue; }
          if (cmd === '/status' && isAdmin(msg)) { await sock.sendMessage(chatId, { text: 'Status: ' + (botEnabled ? 'Running' : 'Paused') }); continue; }
          if (!botEnabled) continue;

          const mediaReply = findMediaReply(text);
          if (mediaReply) { await sendReply(chatId, { text: null, ...mediaReply }); continue; }

          const replyObj = findBestReply(text);
          await sendReply(chatId, { text: replyObj ? replyObj.text : DEFAULT_REPLY });
          console.log('Replied to ' + senderName);
        } catch (err) {
          console.error('Message error:', err.message);
        }
      }
    });

  } catch (err) {
    console.error('Connection error:', err.message);
    reconnectAttempts++;
    setTimeout(() => connectToWhatsApp(), 5000);
  }
}

process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled:', err));

console.log('Starting WhatsApp Bot...\n');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

connectToWhatsApp();
