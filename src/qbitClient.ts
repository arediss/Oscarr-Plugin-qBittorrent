import type { PluginContext, QbitConfig, QbitTorrent, QbitTransferInfo } from './types.js';

const FETCH_TIMEOUT_MS = 8000;

export class QbitClient {
  constructor(private cfg: QbitConfig, private log: PluginContext['log']) {}

  static async fromContext(ctx: PluginContext): Promise<QbitClient | null> {
    const raw = await ctx.getServiceConfigRaw('qbittorrent');
    if (!raw || typeof raw.url !== 'string' || typeof raw.apiKey !== 'string') return null;
    return new QbitClient(
      {
        url: raw.url.replace(/\/+$/, ''),
        apiKey: raw.apiKey,
      },
      ctx.log,
    );
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      Referer: this.cfg.url,
      ...(extra ?? {}),
    };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.cfg.url}${path}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) throw new Error('AUTH_FAILED');
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return (await res.json()) as T;
  }

  private async post(path: string, form: URLSearchParams): Promise<string> {
    const res = await fetch(`${this.cfg.url}${path}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      body: form.toString(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) throw new Error('AUTH_FAILED');
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
    await this.post('/api/v2/torrents/stop', new URLSearchParams({ hashes: hashes.join('|') }));
  }

  async resume(hashes: string[]): Promise<void> {
    await this.post('/api/v2/torrents/start', new URLSearchParams({ hashes: hashes.join('|') }));
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
    const body = await this.post('/api/v2/torrents/add', form);
    const trimmed = body.trim();
    if (trimmed && trimmed !== 'Ok.') throw new Error('ADD_REJECTED');
  }
}
