const BASE = '/api/plugins/qbittorrent-manager';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) msg = data.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface Torrent {
  hash: string;
  name: string;
  state: string;
  progress: number;
  size: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  ratio: number;
  category: string;
  tags: string;
  added_on: number;
  num_seeds: number;
  num_leechs: number;
}

export interface TransferInfo {
  dl_info_speed: number;
  dl_info_data: number;
  up_info_speed: number;
  up_info_data: number;
  connection_status: string;
}

export interface ImportRecord {
  hash: string;
  service: 'sonarr' | 'radarr';
  status: 'imported' | 'grabbed';
  at: string;
  title?: string;
}

export const api = {
  status: () => request<{ configured: boolean; url: string | null }>('GET', '/status'),
  torrents: () => request<Torrent[]>('GET', '/torrents'),
  transfer: () => request<TransferInfo>('GET', '/transfer'),
  imports: () => request<Record<string, ImportRecord>>('GET', '/imports'),
  pause: (hashes: string[]) => request<{ ok: true }>('POST', '/torrents/pause', { hashes }),
  resume: (hashes: string[]) => request<{ ok: true }>('POST', '/torrents/resume', { hashes }),
  remove: (hashes: string[], deleteFiles: boolean) =>
    request<{ ok: true }>('POST', '/torrents/delete', { hashes, deleteFiles }),
  addMagnet: (magnet: string, category?: string) =>
    request<{ ok: true }>('POST', '/torrents/add-magnet', { magnet, category }),
};

export function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number): string {
  if (seconds <= 0 || seconds >= 8_640_000) return '∞';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export const STATE_LABEL: Record<string, { label: string; tone: string }> = {
  downloading: { label: 'Downloading', tone: 'text-ndp-accent' },
  forcedDL: { label: 'Forced DL', tone: 'text-ndp-accent' },
  uploading: { label: 'Seeding', tone: 'text-ndp-success' },
  forcedUP: { label: 'Forced seed', tone: 'text-ndp-success' },
  stalledDL: { label: 'Stalled', tone: 'text-amber-400' },
  stalledUP: { label: 'Stalled (seed)', tone: 'text-ndp-text-dim' },
  pausedDL: { label: 'Paused', tone: 'text-ndp-text-dim' },
  pausedUP: { label: 'Paused', tone: 'text-ndp-text-dim' },
  queuedDL: { label: 'Queued', tone: 'text-ndp-text-dim' },
  queuedUP: { label: 'Queued', tone: 'text-ndp-text-dim' },
  checkingDL: { label: 'Checking', tone: 'text-amber-400' },
  checkingUP: { label: 'Checking', tone: 'text-amber-400' },
  checkingResumeData: { label: 'Resuming', tone: 'text-amber-400' },
  allocating: { label: 'Allocating', tone: 'text-amber-400' },
  moving: { label: 'Moving', tone: 'text-amber-400' },
  metaDL: { label: 'Fetching metadata', tone: 'text-ndp-text-dim' },
  error: { label: 'Error', tone: 'text-ndp-danger' },
  missingFiles: { label: 'Missing files', tone: 'text-ndp-danger' },
};
