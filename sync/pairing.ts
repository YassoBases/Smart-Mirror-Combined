import { EventEmitter } from 'events';
import type { Connection } from './connection';
import type { Identity, QRPayload } from './types';
import { writeIdentity } from './identity';
import { generateKeyPair, deriveSharedSecret, randomBytes, generatePairingCode } from './crypto';

const REFRESH_INTERVAL_MS = 290_000; // refresh 10 s before the 5-min session window

/**
 * Drives the one-time pairing handshake.
 *
 * Events:
 *   qr           ({ raw: string; dataUrl: string })  — show/refresh QR
 *   qr_expiring  ()                                  — session about to expire, grey out QR
 *   linked       (identity: Identity)                — pairing complete
 */
export class PairingSession extends EventEmitter {
  private keypair: { publicKey: string; privateKey: string } | null = null;
  private sid: string | null = null;
  private shortCode: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private _stopped = false;

  // Bound references so we can remove them cleanly
  private readonly _onConnected = () => this._sendHello();
  private readonly _onMessage   = (msg: Record<string, unknown>) => this._handleMessage(msg);

  constructor(
    private readonly conn: Connection,
    private readonly backendUrl: string,
    private readonly mirrorHttpUrl: string,
    private readonly identityPath: string,
  ) {
    super();
  }

  async start(existingKeypair?: { publicKey: string; privateKey: string }): Promise<void> {
    this.keypair   = existingKeypair ?? await generateKeyPair();
    this.shortCode = await generatePairingCode();

    // Persist private key immediately so a mid-pairing crash doesn't lose it
    writeIdentity(this.identityPath, {
      privateKey: this.keypair.privateKey,
      publicKey:  this.keypair.publicKey,
    });

    this.conn.on('connected', this._onConnected);
    this.conn.on('message',   this._onMessage);

    if (this.conn.isConnected()) this._sendHello();
  }

  stop(): void {
    this._stopped = true;
    this._clearRefresh();
    this.conn.off('connected', this._onConnected);
    this.conn.off('message',   this._onMessage);
  }

  private _sendHello(): void {
    if (!this.keypair || !this.shortCode || this._stopped) return;
    this.conn.send({
      type:              'hello',
      mirror_public_key: this.keypair.publicKey,
      short_code:        this.shortCode,
    });
  }

  private async _handleMessage(msg: Record<string, unknown>): Promise<void> {
    if (this._stopped) return;

    if (msg.type === 'pairing_session') {
      this.sid = msg.sid as string;
      await this._emitQR();
      this._startRefreshTimer();
    } else if (msg.type === 'linked') {
      await this._handleLinked(msg as {
        device_token: string;
        account_id: string;
        phone_public_key: string;
      });
    }
  }

  private async _emitQR(): Promise<void> {
    if (!this.keypair || !this.sid || !this.shortCode) return;

    const nonce = await randomBytes(16);
    const payload: QRPayload = {
      v:         1,
      backend:   this.backendUrl,
      mirrorUrl: this.mirrorHttpUrl,
      sid:       this.sid,
      mpk:       this.keypair.publicKey,
      nonce,
      code:      this.shortCode,
    };
    const raw = JSON.stringify(payload);

    // QR image encodes a URL so the phone camera app can open it directly in a
    // browser, and programmatic QR readers can extract the IP/port/params.
    // Format: http://<LAN_IP>:<PORT>/pair?sid=<SID>&code=<CODE>
    const pairingUrl =
      `${this.mirrorHttpUrl}/pair` +
      `?sid=${encodeURIComponent(this.sid)}` +
      `&code=${encodeURIComponent(this.shortCode)}`;

    let dataUrl = '';
    try {
      const qrcode = await import('qrcode');
      dataUrl = await qrcode.toDataURL(pairingUrl, { errorCorrectionLevel: 'M', width: 300 });
    } catch {
      // qrcode optional — caller can still encode `raw` with any library
    }

    this.emit('qr', { raw, dataUrl, shortCode: this.shortCode, pairingUrl });
  }

  private _startRefreshTimer(): void {
    this._clearRefresh();
    this.refreshTimer = setInterval(async () => {
      if (this._stopped) return;
      this.emit('qr_expiring');

      // Rotate the short code on every session refresh so it expires with the QR
      this.shortCode = await generatePairingCode();

      if (this.conn.isConnected()) {
        this.conn.send({ type: 'refresh_session', new_short_code: this.shortCode });
      }
      // Backend will reply with a new pairing_session → _handleMessage calls _emitQR
    }, REFRESH_INTERVAL_MS);
  }

  private _clearRefresh(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
  }

  private async _handleLinked(msg: {
    device_token: string;
    account_id: string;
    phone_public_key: string;
  }): Promise<void> {
    if (!this.keypair) return;
    this.stop(); // detach all listeners before emitting

    // Only derive a shared secret if the phone actually sent its public key.
    // The Flutter app omits phonePublicKey, so skip rather than crash libsodium.
    const sharedSecret = msg.phone_public_key
      ? await deriveSharedSecret(this.keypair.privateKey, msg.phone_public_key)
      : '';

    const identity: Identity = {
      privateKey:     this.keypair.privateKey,
      publicKey:      this.keypair.publicKey,
      deviceToken:    msg.device_token,
      accountId:      msg.account_id,
      phonePublicKey: msg.phone_public_key,
      sharedSecret,
    };

    writeIdentity(this.identityPath, identity);
    this.emit('linked', identity);
  }
}
