import type { PluginContext } from './types.js';

export interface ImportRecord {
  /** Lowercase torrent hash, matches qBit's `hash` field after toLowerCase. */
  hash: string;
  service: 'sonarr' | 'radarr';
  /** `imported` = downloadFolderImported event found (file is in the library);
   *  `grabbed`  = grabbed event found but no import yet (tracked, still processing). */
  status: 'imported' | 'grabbed';
  at: string;
  title?: string;
}

interface ArrHistoryResponse {
  records?: Array<{
    downloadId?: string;
    date?: string;
    sourceTitle?: string;
    eventType?: string;
    movie?: { title?: string };
    series?: { title?: string };
    episode?: { title?: string };
  }>;
}

const HISTORY_PAGE_SIZE = 2000;
const FETCH_TIMEOUT_MS = 8000;
// Sonarr/Radarr v3 API expects the numeric enum value (string names get rejected with 400).
// Same enum across Sonarr and Radarr: 1 = grabbed, 3 = downloadFolderImported.
const EVENT_GRABBED = 1;
const EVENT_IMPORTED = 3;

async function fetchEvent(
  type: 'sonarr' | 'radarr',
  cfg: { url: string; apiKey: string },
  eventType: number,
  status: ImportRecord['status'],
  log: PluginContext['log'],
): Promise<ImportRecord[]> {
  const baseUrl = cfg.url.replace(/\/+$/, '');
  const url = `${baseUrl}/api/v3/history?eventType=${eventType}&pageSize=${HISTORY_PAGE_SIZE}`;
  try {
    const res = await fetch(url, {
      headers: { 'X-Api-Key': cfg.apiKey },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      log.warn(`[qBittorrent Manager] ${type} history HTTP ${res.status} (eventType=${eventType})`);
      return [];
    }
    const data = (await res.json()) as ArrHistoryResponse;
    const out: ImportRecord[] = [];
    for (const r of data.records ?? []) {
      if (!r.downloadId) continue;
      out.push({
        hash: r.downloadId.toLowerCase(),
        service: type,
        status,
        at: r.date ?? new Date().toISOString(),
        title: r.sourceTitle ?? r.movie?.title ?? r.series?.title,
      });
    }
    return out;
  } catch (err) {
    log.warn(`[qBittorrent Manager] ${type} history fetch failed (eventType=${eventType}): ${(err as Error).message}`);
    return [];
  }
}

export async function fetchImports(ctx: PluginContext): Promise<Record<string, ImportRecord>> {
  const all: ImportRecord[] = [];
  for (const type of ['sonarr', 'radarr'] as const) {
    const cfg = await ctx.getServiceConfigRaw(type);
    if (!cfg || typeof cfg.url !== 'string' || typeof cfg.apiKey !== 'string') continue;
    const cred = { url: cfg.url, apiKey: cfg.apiKey };
    // Imported events first so the dedup pass below promotes them over plain grabs.
    const [imported, grabbed] = await Promise.all([
      fetchEvent(type, cred, EVENT_IMPORTED, 'imported', ctx.log),
      fetchEvent(type, cred, EVENT_GRABBED, 'grabbed', ctx.log),
    ]);
    all.push(...imported, ...grabbed);
  }
  // Dedupe by hash. `imported` outranks `grabbed`; within the same status, keep the most recent.
  const map: Record<string, ImportRecord> = {};
  for (const r of all) {
    const existing = map[r.hash];
    if (!existing) { map[r.hash] = r; continue; }
    if (existing.status === 'grabbed' && r.status === 'imported') map[r.hash] = r;
    else if (existing.status === r.status && existing.at < r.at) map[r.hash] = r;
  }
  return map;
}
