import type { FastifyInstance } from 'fastify';
import type { PluginContext } from './types.js';
import { QbitClient } from './qbitClient.js';
import { fetchImports, type ImportRecord } from './arrClient.js';

export const PERMISSION_VIEW = 'qbittorrent.view';
export const PERMISSION_MANAGE = 'qbittorrent.manage';

const IMPORTS_TTL_MS = 60_000;
let importsCache: { data: Record<string, ImportRecord>; fetchedAt: number } | null = null;
let importsInflight: Promise<Record<string, ImportRecord>> | null = null;

export async function registerQbitRoutes(app: FastifyInstance, ctx: PluginContext) {
  const guard = async () => {
    const client = await QbitClient.fromContext(ctx);
    if (!client) {
      const err = new Error('No qBittorrent service is configured');
      (err as Error & { statusCode: number }).statusCode = 412;
      throw err;
    }
    return client;
  };

  const hashesSchema = {
    type: 'object',
    required: ['hashes'],
    properties: {
      hashes: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 200 },
    },
  } as const;

  app.get('/torrents', async () => {
    const client = await guard();
    return client.listTorrents();
  });

  app.get('/transfer', async () => {
    const client = await guard();
    return client.transferInfo();
  });

  app.get('/status', async () => {
    const raw = await ctx.getServiceConfigRaw('qbittorrent');
    return { configured: !!raw, url: raw?.url ?? null };
  });

  app.get('/imports', async () => {
    const now = Date.now();
    if (importsCache && now - importsCache.fetchedAt < IMPORTS_TTL_MS) return importsCache.data;
    if (importsInflight) return importsInflight;
    importsInflight = fetchImports(ctx).finally(() => { importsInflight = null; });
    const data = await importsInflight;
    importsCache = { data, fetchedAt: Date.now() };
    return data;
  });

  app.post<{ Body: { hashes: string[] } }>(
    '/torrents/pause',
    { schema: { body: hashesSchema } },
    async (req) => {
      const client = await guard();
      await client.pause(req.body.hashes);
      return { ok: true };
    },
  );

  app.post<{ Body: { hashes: string[] } }>(
    '/torrents/resume',
    { schema: { body: hashesSchema } },
    async (req) => {
      const client = await guard();
      await client.resume(req.body.hashes);
      return { ok: true };
    },
  );

  app.post<{ Body: { hashes: string[]; deleteFiles?: boolean } }>(
    '/torrents/delete',
    {
      schema: {
        body: {
          type: 'object',
          required: ['hashes'],
          properties: {
            hashes: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, maxItems: 200 },
            deleteFiles: { type: 'boolean' },
          },
        },
      },
    },
    async (req) => {
      const client = await guard();
      await client.remove(req.body.hashes, req.body.deleteFiles ?? false);
      return { ok: true };
    },
  );

  app.post<{ Body: { magnet: string; category?: string } }>(
    '/torrents/add-magnet',
    {
      schema: {
        body: {
          type: 'object',
          required: ['magnet'],
          properties: {
            magnet: { type: 'string', minLength: 8, maxLength: 4096 },
            category: { type: 'string', maxLength: 100 },
          },
        },
      },
    },
    async (req) => {
      // qBit's /torrents/add accepts urls=http(s)://... too — must reject anything not strictly
      // a magnet: URL to prevent SSRF via internal http(s) endpoints.
      const magnet = req.body.magnet.trim();
      let parsed: URL;
      try { parsed = new URL(magnet); } catch {
        const err = new Error('Invalid magnet URL');
        (err as Error & { statusCode: number }).statusCode = 400;
        throw err;
      }
      if (parsed.protocol !== 'magnet:') {
        const err = new Error('Only magnet: URLs are accepted');
        (err as Error & { statusCode: number }).statusCode = 400;
        throw err;
      }
      const client = await guard();
      await client.addMagnet(magnet, req.body.category);
      return { ok: true };
    },
  );
}
