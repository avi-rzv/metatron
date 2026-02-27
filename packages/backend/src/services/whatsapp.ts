import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  getContentType,
  downloadMediaMessage,
  type WASocket,
  type ConnectionState,
  type WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import pino from 'pino';
import QRCode from 'qrcode';

export type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

export interface BufferedMessage {
  id: string;
  from: string;
  fromName: string | null;
  to: string;
  body: string;
  timestamp: number;
  fromMe: boolean;
  isGroup: boolean;
  isVoiceMessage: boolean;
  audioBuffer: Buffer | null;
  audioMimeType: string | null;
}

const AUTH_DIR = './data/whatsapp-auth';
const BUFFER_MAX = 100;
const MAX_RECONNECT_ATTEMPTS = 5;
/** Skip messages older than this during history sync (ms) */
const MAX_MESSAGE_AGE = 120_000; // 2 minutes
const logger = pino({ level: 'silent' });

/** Extract digits-only phone number from a JID like "972501234567:0@s.whatsapp.net" */
function phoneFromJid(jid: string): string {
  return jid.replace(/:.*$/, '').replace(/@.*$/, '').replace(/[^0-9]/g, '');
}

class WhatsAppService extends EventEmitter {
  private sock: WASocket | null = null;
  private _status: WhatsAppStatus = 'disconnected';
  private _qrDataUrl: string | null = null;
  private _phoneNumber: string | null = null;
  private messageBuffer: BufferedMessage[] = [];
  /** Track processed message IDs to avoid duplicates across notify/append */
  private seenMessageIds = new Set<string>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  /** True once a session has been fully established (connection opened) */
  private hasSession = false;
  /** True if auth state existed when connect() was called (detects stale session failures) */
  private hadStoredAuth = false;
  /** Map LID numbers to phone numbers (Baileys v7 uses LIDs for privacy) */
  private lidToPhone = new Map<string, string>();

  get status(): WhatsAppStatus {
    return this._status;
  }

  get qrDataUrl(): string | null {
    return this._qrDataUrl;
  }

  get phoneNumber(): string | null {
    return this._phoneNumber;
  }

  async connect(): Promise<void> {
    console.log('[WhatsApp] connect() called, status:', this._status);

    if (this._status === 'connected') return;
    if (this._status !== 'disconnected') return;

    this.setStatus('connecting');
    this.hadStoredAuth = existsSync(`${AUTH_DIR}/creds.json`);

    try {
      const [{ state, saveCreds }, { version }] = await Promise.all([
        useMultiFileAuthState(AUTH_DIR),
        fetchLatestWaWebVersion({}).catch(() => ({ version: undefined as any })),
      ]);
      console.log('[WhatsApp] Auth state loaded, WA version:', version, '— creating socket...');

      this.sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        logger,
        browser: Browsers.ubuntu('Metatron'),
        printQRInTerminal: false,
        ...(version ? { version } : {}),
      });
      console.log('[WhatsApp] Socket created, waiting for events...');

      this.sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;
        console.log('[WhatsApp] connection.update:', { connection, hasQr: !!qr });

        if (qr) {
          try {
            this._qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
            this.setStatus('qr_ready');
            this.emit('qr', this._qrDataUrl);
          } catch (err) {
            console.error('[WhatsApp] QR generation failed:', err);
          }
        }

        if (connection === 'close') {
          this._qrDataUrl = null;
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          console.log('[WhatsApp] Connection closed, statusCode:', statusCode, 'error:', lastDisconnect?.error?.message);

          this.sock = null;

          if (statusCode === DisconnectReason.loggedOut) {
            this.hasSession = false;
            this._phoneNumber = null;
            this.emit('logged_out');
            // Clear stale auth and reconnect to produce a fresh QR
            console.log('[WhatsApp] Logged out — clearing auth for fresh QR...');
            const { rm } = await import('fs/promises');
            try { await rm(AUTH_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
            this.reconnectTimer = setTimeout(() => this.doReconnect(), 500);
            return;
          }

          // 515 = restart required — mandatory reconnect (happens after QR scan)
          const mustReconnect = statusCode === DisconnectReason.restartRequired;

          if ((mustReconnect || this.hasSession) && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            console.log(`[WhatsApp] Reconnecting (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}, reason: ${statusCode})...`);
            this.reconnectTimer = setTimeout(() => this.doReconnect(), 1000);
          } else if (!this.hasSession && !mustReconnect && this.hadStoredAuth) {
            // Stored credentials failed (expired/invalidated) — clear auth and retry with fresh QR
            console.log('[WhatsApp] Stored session failed, clearing auth for fresh QR...');
            this.hadStoredAuth = false;
            const { rm } = await import('fs/promises');
            try { await rm(AUTH_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
            this.reconnectTimer = setTimeout(() => this.doReconnect(), 500);
          } else {
            // No session yet (still pairing) or max retries hit — give up
            if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
              console.log('[WhatsApp] Max reconnect attempts reached, giving up');
            }
            this.reconnectAttempts = 0;
            this.setStatus('disconnected');
          }
        }

        if (connection === 'open') {
          this._qrDataUrl = null;
          this.hasSession = true;
          this.reconnectAttempts = 0;
          this._phoneNumber = this.sock?.user?.id?.replace(/:.*@/, '@').replace('@s.whatsapp.net', '') ?? null;
          this.setStatus('connected');
          this.emit('connected', this._phoneNumber);
          console.log('[WhatsApp] Connected as', this._phoneNumber);
        }
      });

      this.sock.ev.on('creds.update', saveCreds);

      // --- LID-to-phone mapping (Baileys v7 uses LIDs instead of phone JIDs) ---
      this.sock.ev.on('lid-mapping.update' as any, (mapping: { lid: string; pn: string }) => {
        const lidNum = phoneFromJid(mapping.lid);
        const phoneNum = phoneFromJid(mapping.pn);
        if (lidNum && phoneNum) {
          this.lidToPhone.set(lidNum, phoneNum);
          console.log(`[WhatsApp] LID mapping: ${lidNum} → ${phoneNum}`);
        }
      });
      this.sock.ev.on('contacts.upsert', (contacts: any[]) => {
        for (const c of contacts) {
          const lid = c.lid ? phoneFromJid(c.lid) : null;
          const pn = c.phoneNumber ? phoneFromJid(c.phoneNumber) : null;
          if (lid && pn) {
            this.lidToPhone.set(lid, pn);
          }
        }
      });
      this.sock.ev.on('messaging-history.set' as any, (data: { contacts: any[] }) => {
        if (!data.contacts) return;
        for (const c of data.contacts) {
          const lid = c.lid ? phoneFromJid(c.lid) : null;
          const pn = c.phoneNumber ? phoneFromJid(c.phoneNumber) : null;
          if (lid && pn) {
            this.lidToPhone.set(lid, pn);
          }
        }
      });

      this.sock.ev.on('messages.upsert', ({ messages, type }) => {
        console.log(`[WhatsApp] messages.upsert fired: type=${type}, count=${messages.length}`);
        // Handler must stay synchronous — async handlers block Baileys' event queue.
        // Each message is processed in a fire-and-forget async call.
        for (const msg of messages) {
          const ct = msg.message ? getContentType(msg.message) : 'none';
          console.log(`[WhatsApp]   raw msg: id=${msg.key.id}, jid=${msg.key.remoteJid}, fromMe=${msg.key.fromMe}, contentType=${ct}`);
          this.processIncomingMessage(msg, type).catch((err) => {
            console.error('[WhatsApp] Message processing error:', err);
          });
        }
      });
    } catch (err) {
      console.error('[WhatsApp] connect() failed:', err);
      this.sock = null;
      this.setStatus('disconnected');
    }
  }

  private async processIncomingMessage(msg: any, type: string): Promise<void> {
    if (!msg.message) return;

    const msgId = msg.key.id ?? '';

    // Deduplicate — same message can arrive via both 'notify' and 'append'
    if (this.seenMessageIds.has(msgId)) return;
    this.seenMessageIds.add(msgId);
    // Prevent unbounded growth
    if (this.seenMessageIds.size > BUFFER_MAX * 2) {
      const ids = [...this.seenMessageIds];
      this.seenMessageIds = new Set(ids.slice(-BUFFER_MAX));
    }

    const contentType = getContentType(msg.message);

    // Skip non-user message types (protocol handshakes, reactions, key distribution, etc.)
    if (!contentType || [
      'protocolMessage', 'senderKeyDistributionMessage',
      'reactionMessage', 'pollCreationMessage', 'pollUpdateMessage',
    ].includes(contentType)) return;

    let body = '';
    let isVoice = false;
    let voiceBuffer: Buffer | null = null;
    let voiceMime: string | null = null;

    if (contentType === 'conversation') {
      body = msg.message.conversation ?? '';
    } else if (contentType === 'extendedTextMessage') {
      body = msg.message.extendedTextMessage?.text ?? '';
    } else if (contentType === 'imageMessage') {
      body = `[Image] ${msg.message.imageMessage?.caption ?? ''}`.trim();
    } else if (contentType === 'videoMessage') {
      body = `[Video] ${msg.message.videoMessage?.caption ?? ''}`.trim();
    } else if (contentType === 'documentMessage') {
      body = `[Document] ${msg.message.documentMessage?.fileName ?? ''}`.trim();
    } else if (contentType === 'audioMessage') {
      body = '[Audio message]';
      // Download voice messages (PTT) for transcription
      const audioMsg = msg.message.audioMessage;
      if (audioMsg?.ptt) {
        try {
          const audioBuffer = await downloadMediaMessage(msg as WAMessage, 'buffer', {}) as Buffer;
          isVoice = true;
          voiceBuffer = audioBuffer;
          voiceMime = audioMsg.mimetype ?? 'audio/ogg';
        } catch (err) {
          console.error('[WhatsApp] Failed to download voice message:', err);
        }
      }
    } else if (contentType === 'stickerMessage') {
      body = '[Sticker]';
    } else {
      body = `[${contentType}]`;
    }

    const jid = msg.key.remoteJid ?? '';
    // Handle Long (protobuf) timestamps from Baileys
    const rawTs = msg.messageTimestamp;
    const tsSeconds = typeof rawTs === 'number'
      ? rawTs
      : rawTs && typeof (rawTs as any).toNumber === 'function'
        ? (rawTs as any).toNumber()
        : 0;
    const timestamp = tsSeconds > 0 ? tsSeconds * 1000 : Date.now();

    // Skip old messages from history sync (older than 2 minutes)
    if (type !== 'notify' && (Date.now() - timestamp) > MAX_MESSAGE_AGE) return;

    // Resolve LID JIDs to phone JIDs for downstream matching
    let resolvedJid = jid;
    if (jid.includes('@lid')) {
      const lidNum = phoneFromJid(jid);
      // Check cache first
      let phoneNum = this.lidToPhone.get(lidNum);
      // If not cached, ask Baileys' signal repository
      if (!phoneNum && this.sock?.signalRepository?.lidMapping) {
        try {
          const pnJid = await (this.sock.signalRepository as any).lidMapping.getPNForLID(jid);
          if (pnJid) {
            phoneNum = phoneFromJid(pnJid);
            this.lidToPhone.set(lidNum, phoneNum);
            console.log(`[WhatsApp] Resolved LID via signal repo: ${lidNum} → ${phoneNum}`);
          }
        } catch { /* ignore — signal repo may not be ready */ }
      }
      if (phoneNum) {
        resolvedJid = `${phoneNum}@s.whatsapp.net`;
      } else {
        console.log(`[WhatsApp] Unresolved LID: ${lidNum} (no phone mapping yet)`);
      }
    }

    const buffered: BufferedMessage = {
      id: msgId,
      from: msg.key.fromMe ? (this.sock?.user?.id ?? '') : resolvedJid,
      fromName: msg.pushName ?? null,
      to: msg.key.fromMe ? resolvedJid : (this.sock?.user?.id ?? ''),
      body,
      timestamp,
      fromMe: msg.key.fromMe ?? false,
      isGroup: jid.endsWith('@g.us'),
      isVoiceMessage: isVoice,
      audioBuffer: voiceBuffer,
      audioMimeType: voiceMime,
    };

    const direction = buffered.fromMe ? '→' : '←';
    const who = buffered.fromName ?? resolvedJid.replace(/@.*$/, '');
    console.log(`[WhatsApp] ${direction} ${who}: "${buffered.body.slice(0, 100)}"${buffered.isGroup ? ' (group)' : ''}`);

    this.messageBuffer.push(buffered);
    if (this.messageBuffer.length > BUFFER_MAX) {
      const evicted = this.messageBuffer.shift();
      // Release audio buffer memory on eviction
      if (evicted) evicted.audioBuffer = null;
    }

    this.emit('message', buffered);
  }

  async disconnect(clearSession = false): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempts = 0;
    this.hasSession = false;

    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        this.sock.end(undefined);
      }
      this.sock = null;
    }

    this._qrDataUrl = null;
    this._phoneNumber = null;
    this.setStatus('disconnected');

    if (clearSession) {
      const { rm } = await import('fs/promises');
      try {
        await rm(AUTH_DIR, { recursive: true, force: true });
      } catch {
        // Directory may not exist
      }
    }
  }

  async listGroups(): Promise<{ jid: string; name: string; participantCount: number }[]> {
    if (!this.sock || this._status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }

    const groups = await this.sock.groupFetchAllParticipating();
    return Object.values(groups).map(g => ({
      jid: g.id,
      name: g.subject,
      participantCount: g.participants.length,
    }));
  }

  async sendMessage(target: string, text: string): Promise<{ success: boolean; jid: string }> {
    if (!this.sock || this._status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }

    const jid = target.endsWith('@g.us') ? target : this.phoneToJid(target);
    await this.sock.sendMessage(jid, { text });
    return { success: true, jid };
  }

  async sendVoiceMessage(target: string, audioBuffer: Buffer): Promise<{ success: boolean; jid: string }> {
    if (!this.sock || this._status !== 'connected') {
      throw new Error('WhatsApp is not connected');
    }

    const jid = target.endsWith('@g.us') ? target : this.phoneToJid(target);
    await this.sock.sendMessage(jid, {
      audio: audioBuffer,
      ptt: true,
      mimetype: 'audio/ogg; codecs=opus',
    });
    return { success: true, jid };
  }

  getMessages(contact?: string, limit = 50): BufferedMessage[] {
    let msgs = [...this.messageBuffer];

    if (contact) {
      if (contact.includes('@g.us')) {
        // Group JID — match against from/to fields directly
        msgs = msgs.filter(m => m.from === contact || m.to === contact);
      } else {
        const normalized = contact.replace(/[^0-9]/g, '');
        msgs = msgs.filter(m => {
          const fromNum = m.from.replace(/[^0-9]/g, '');
          const toNum = m.to.replace(/[^0-9]/g, '');
          return fromNum.includes(normalized) || toNum.includes(normalized);
        });
      }
    }

    return msgs.slice(-limit);
  }

  private phoneToJid(phone: string): string {
    const cleaned = phone.replace(/[^0-9]/g, '');
    return `${cleaned}@s.whatsapp.net`;
  }

  private setStatus(status: WhatsAppStatus): void {
    this._status = status;
    this.emit('status', status);
  }

  private async doReconnect(): Promise<void> {
    // Reset to disconnected so connect() guard allows re-entry
    this._status = 'disconnected';
    this.sock = null;
    await this.connect();
  }
}

// Singleton export
export const whatsapp = new WhatsAppService();
