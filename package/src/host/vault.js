/**
 * Credential handling for Amazon Ads.
 *
 * Secrets never enter SQLite. They live in the Harness credential service when
 * the Host provides one (`ctx.credentials`), and otherwise in a 0600 JSON file
 * inside the plugin's data directory. Either way the record is AES-256-GCM
 * encrypted with a key derived from the profile's own secret material, so a
 * copied data directory alone does not leak a refresh token.
 * @module host/vault
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * @typedef {object} AmazonCredentials
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} refreshToken
 * @property {string} [profileId]
 */

/**
 * Encrypt one JSON value.
 * @param {string} plaintext
 * @param {string} passphrase
 * @returns {{v: number, iv: string, tag: string, data: string}}
 */
export function seal(plaintext, passphrase) {
  const key = createHash('sha256').update(passphrase).digest();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

/**
 * Decrypt a sealed value; returns `undefined` when the payload is damaged or
 * was sealed with different key material rather than throwing at a call site.
 * @param {{v?: number, iv: string, tag: string, data: string}} sealed
 * @param {string} passphrase
 * @returns {string|undefined}
 */
export function open(sealed, passphrase) {
  try {
    const key = createHash('sha256').update(passphrase).digest();
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}

/**
 * Storage for one account's Amazon credentials.
 *
 * Two backends behind one interface:
 *  - `credentials` — the Harness credential service (preferred, profile-wide);
 *  - `file` — an encrypted sidecar file with 0600 permissions.
 */
export class CredentialVault {
  /**
   * @param {object} options
   * @param {string} options.dataDir
   * @param {string} options.passphrase     Key material; never persisted by us.
   * @param {{resolve?: Function, set?: Function, unset?: Function, describe?: Function}} [options.credentials]
   * @param {(message: string, error?: unknown) => void} [options.log]
   */
  constructor(options) {
    this.dataDir = options.dataDir;
    this.passphrase = options.passphrase;
    this.credentials = options.credentials;
    this.log = options.log ?? (() => {});
    this.file = join(this.dataDir, 'secrets.enc.json');
    this.cache = new Map();
    this.#loadFile();
  }

  #loadFile() {
    try {
      if (!existsSync(this.file)) return;
      const raw = readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      for (const [accountId, sealed] of Object.entries(parsed.accounts ?? {})) {
        const plaintext = open(sealed, this.passphrase);
        if (plaintext === undefined) continue;
        try {
          this.cache.set(accountId, JSON.parse(plaintext));
        } catch {
          /* skip an unreadable entry; the account simply reports disconnected */
        }
      }
    } catch (error) {
      this.log('vault: could not read the encrypted secret file', error);
    }
  }

  #persistFile() {
    mkdirSync(this.dataDir, { recursive: true });
    /** @type {Record<string, unknown>} */
    const accounts = {};
    for (const [accountId, value] of this.cache) {
      accounts[accountId] = seal(JSON.stringify(value), this.passphrase);
    }
    writeFileSync(this.file, JSON.stringify({ version: 1, accounts }, null, 2), { mode: 0o600 });
    try {
      chmodSync(this.file, 0o600);
    } catch {
      /* a filesystem without POSIX modes still stores the file */
    }
  }

  /**
   * Credential service key for one account: the owning scope is fixed, the id
   * is the account. Written as a plain string so the vault keeps no dependency
   * on the credential package's branding helper.
   * @param {string} accountId
   * @returns {string}
   */
  keyOf(accountId) {
    const safe = String(accountId).replace(/[^A-Za-z0-9._-]/gu, '-');
    return `scale-commander/${safe}`;
  }

  /**
   * @param {string} accountId
   * @returns {Promise<AmazonCredentials|undefined>}
   */
  async get(accountId) {
    const cached = this.cache.get(accountId);
    if (cached !== undefined) return cached;
    if (this.credentials?.readRecord === undefined) return undefined;
    try {
      const record = await this.credentials.readRecord(this.keyOf(accountId));
      const payload = record?.payload ?? record;
      if (typeof payload?.secret === 'string') {
        const value = JSON.parse(payload.secret);
        this.cache.set(accountId, value);
        return value;
      }
      if (typeof payload?.value === 'string') {
        const value = JSON.parse(payload.value);
        this.cache.set(accountId, value);
        return value;
      }
    } catch (error) {
      this.log(`vault: credential service lookup failed for ${accountId}`, error);
    }
    return undefined;
  }

  /**
   * Store credentials for one account in both backends when available, so a
   * profile migration that loses one still has the other.
   * @param {string} accountId
   * @param {AmazonCredentials} value
   * @returns {Promise<{storedIn: string[]}>}
   */
  async set(accountId, value) {
    const storedIn = [];
    this.cache.set(accountId, value);
    this.#persistFile();
    storedIn.push('encrypted-file');
    if (this.credentials?.set !== undefined) {
      try {
        const key = this.keyOf(accountId);
        if (this.credentials.modifyRecord !== undefined) {
          await this.credentials.modifyRecord(key, async () => ({ kind: 'grant', payload: { secret: JSON.stringify(value) } }));
        } else {
          await this.credentials.set(key, JSON.stringify(value));
        }
        storedIn.push('credential-service');
      } catch (error) {
        this.log('vault: the credential service refused the secret; the encrypted file remains', error);
      }
    }
    return { storedIn };
  }

  /**
   * @param {string} accountId
   * @returns {Promise<void>}
   */
  async delete(accountId) {
    this.cache.delete(accountId);
    this.#persistFile();
    if (this.credentials?.unset !== undefined) {
      try {
        const key = this.keyOf(accountId);
        if (this.credentials.deleteRecord !== undefined) await this.credentials.deleteRecord(key);
        else if (this.credentials.unset !== undefined) await this.credentials.unset(key);
      } catch {
        /* an absent record is the desired end state */
      }
    }
  }

  /**
   * Masked status for the UI. Never returns secret material.
   * @param {string} accountId
   * @returns {Promise<{configured: boolean, clientIdHint: string, hasRefreshToken: boolean, storedIn: string[]}>}
   */
  async status(accountId) {
    const value = await this.get(accountId);
    const storedIn = [];
    if (this.cache.has(accountId)) storedIn.push('encrypted-file');
    if (this.credentials?.describeRecord !== undefined) {
      try {
        const info = await this.credentials.describeRecord(this.keyOf(accountId));
        if (info !== undefined) storedIn.push('credential-service');
      } catch {
        /* absence is not an error */
      }
    }
    return {
      configured: value !== undefined && value.refreshToken.length > 0,
      clientIdHint: value === undefined ? '' : mask(value.clientId),
      hasRefreshToken: value !== undefined && value.refreshToken.length > 0,
      storedIn,
    };
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
export function mask(value) {
  const text = String(value ?? '');
  if (text.length <= 6) return text.length === 0 ? '' : '••••';
  return `${text.slice(0, 4)}••••${text.slice(-2)}`;
}
