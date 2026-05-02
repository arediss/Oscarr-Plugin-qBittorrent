import type { PluginContext, QbitConfig, QbitTorrent, QbitTransferInfo } from './types.js';

const FETCH_TIMEOUT_MS = 8000;

export class QbitClient {
  private cookie: string | null = null;
  private cookieExpiresAt = 0;

  constructor(private cfg: QbitConfig, private log: PluginContext['log']) {}

  static async fromContext(ctx: PluginContext): Promise<QbitClient | null> {
    const raw = await ctx.getServiceConfigRaw('qbittorrent');
    if (!raw || typeof raw.url !== 'string') return null;
    return new QbitClient(
      {
        url: raw.url.replace(/\/+$/, ''),
        username: typeof raw.username === 'string' ? raw.username : '',
        password: typeof raw.password === 'string' ? raw.password : '',
      },
      ctx.log,
    );
  }

  private async login(): Promise<void> {
    const body = new URLSearchParams({ username: this.cfg.username, password: this.cfg.password }).toString();
    const res = await fetch(`${this.cfg.url}/api/v2/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: this.cfg.url,
      },
      body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 403) throw new Error('AUTH_BANNED');
    const text = await res.text();
    if (res.status !== 200 || text !== 'Ok.') throw new Error('AUTH_FAILED');
    const setCookie = res.headers.get('set-cookie') ?? '';
    const sid = setCookie.split(';').map((p) => p.trim()).find((p) => p.startsWith('SID='));
    if (!sid) throw new Error('AUTH_NO_SESSION');
    this.cookie = sid;
    this.cookieExpiresAt = Date.now() + 50 * 60 * 1000;
  }

  private async ensureLogin(): Promise<void> {
    if (this.cookie && Date.now() < this.cookieExpiresAt) return;
    await this.login();
  }

  private async get<T>(path: string): Promise<T> {
    await this.ensureLogin();
    const doFetch = async () => fetch(`${this.cfg.url}${path}`, {
      headers: { Cookie: this.cookie!, Referer: this.cfg.url },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    let res = await doFetch();
    if (res.status === 403 || res.status === 401) {
      this.cookie = null;
      await this.login();
      res = await doFetch();
    }
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return (await res.json()) as T;
  }

  private async post(path: string, form: URLSearchParams): Promise<string> {
    await this.ensureLogin();
    const doFetch = async () => fetch(`${this.cfg.url}${path}`, {
      method: 'POST',
      headers: {
        Cookie: this.cookie!,
        Referer: this.cfg.url,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    let res = await doFetch();
    if (res.status === 403 || res.status === 401) {
      this.cookie = null;
      await this.login();
      res = await doFetch();
    }
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return res.text();
  }

  listTorrents(): Promise<QbitTorrent[]> {
    return this.get<QbitTorrent[]>('/api/v2/torrents/info');
  }

  transferInfo(): Promise<QbitTransferInfo> {
    return this.get<QbitTransferInfo>('/api/v2/transfer/info');
  }

  async pause(hashes: string[]): Promise<void> {
    await this.post('/api/v2/torrents/pause', new URLSearchParams({ hashes: hashes.join('|') }));
  }

  async resume(hashes: string[]): Promise<void> {
    await this.post('/api/v2/torrents/resume', new URLSearchParams({ hashes: hashes.join('|') }));
  }

  async remove(hashes: string[], deleteFiles: boolean): Promise<void> {
    await this.post('/api/v2/torrents/delete', new URLSearchParams({
      hashes: hashes.join('|'),
      deleteFiles: deleteFiles ? 'true' : 'false',
    }));
  }

  async addMagnet(magnetUrl: string, category?: string): Promise<void> {
    const form = new URLSearchParams({ urls: magnetUrl });
    if (category) form.set('category', category);
    // qBit returns 200 with body "Ok." on accept and "Fails." on bad magnet — must inspect body.
    const body = await this.post('/api/v2/torrents/add', form);
    const trimmed = body.trim();
    if (trimmed && trimmed !== 'Ok.') throw new Error('ADD_REJECTED');
  }
}
