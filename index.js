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
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const http = require('http');
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
let latestQR = null;
let botStatus = 'connecting';
let reconnectAttempts = 0;

// ── Helpers ──────────────────────────────────────────────

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

// ── HTTP Server (starts FIRST — Railway needs this) ─────

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  // Health check — Railway pings this
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  // QR image endpoint
  if (req.url === '/qr') {
    if (latestQR) {
      try {
        const buf = await QRCode.toBuffer(latestQR, { width: 400, margin: 2 });
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(buf);
      } catch (e) {
        res.writeHead(500);
        return res.end('Error generating QR');
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('QR not ready yet');
  }

  // Status endpoint
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('Bot status: ' + botStatus);
  }

  // Main page — QR scanner
  const qrImg = latestQR
    ? '<img src="/qr" style="width:350px;border:2px solid #333;border-radius:10px;" />'
    : '<h2 style="color:orange;">QR generating...</h2>';

  const statusColor = botStatus === 'connected' ? 'green' : 'orange';
  const statusText = botStatus === 'connected'
    ? 'Bot is live! Auto-reply active.'
    : 'Waiting for QR scan...';

  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatsApp Bot - QR Scanner</title>
  <style>
    body { font-family: Arial; text-align: center; padding: 40px; background: #f5f5f5; }
    .card { background: white; border-radius: 15px; padding: 30px; max-width: 500px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #25D366; }
    .status { padding: 8px 16px; border-radius: 20px; display: inline-block; color: white; background: ${statusColor}; margin: 10px 0; }
    p { color: #666; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>WhatsApp Bot</h1>
    <div class="status">${statusText}</div>
    <hr>
    ${qrImg}
    <p>Open WhatsApp &rarr; Settings &rarr; Linked Devices &rarr; Link a Device</p>
    <p>Scan the QR code above</p>
    ${botStatus !== 'connected' ? '<p style="color:green;">Page refreshes every 5 seconds</p><script>setTimeout(()=>location.reload(),5000)</script>' : ''}
  </div>
</body>
</html>`);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Web server running on port ' + PORT);
  console.log('Open your Railway domain to scan QR\n');
});

// ── WhatsApp Connection (starts AFTER server) ───────────

async function connectToWhatsApp() {
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
      browser: ['Firefox', 'Safari', '120.0'],
      connectTimeout: 60000,
      keepAliveIntervalMs: 25000,
      markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQR = qr;
        botStatus = 'waiting_for_scan';
        console.log('QR ready — open your Railway domain to scan');
      }

      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log('Connection closed. Reason:', reason);

        if (reason === DisconnectReason.loggedOut) {
          botStatus = 'logged_out';
          try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch (e) {}
          reconnectAttempts = 0;
          setTimeout(() => connectToWhatsApp(), 3000);
        } else {
          botStatus = 'reconnecting';
          reconnectAttempts++;
          const waitTime = Math.min(reconnectAttempts * 2000, 30000);
          console.log('Reconnecting in ' + (waitTime / 1000) + 's...');
          setTimeout(() => connectToWhatsApp(), waitTime);
        }
      }

      if (connection === 'open') {
        reconnectAttempts = 0;
        latestQR = null;
        botStatus = 'connected';
        console.log('Connected! Bot is live!');
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
    botStatus = 'error';
    reconnectAttempts++;
    setTimeout(() => connectToWhatsApp(), 5000);
  }
}

// ── Start ────────────────────────────────────────────────

process.on('SIGINT', () => process.exit(0));
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});

console.log('Starting WhatsApp Bot...\n');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// Start WhatsApp AFTER server is listening
setTimeout(() => connectToWhatsApp(), 1000);
