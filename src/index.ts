import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { PluginContext, RegisterRoutes } from './types.js';
import { PERMISSION_VIEW, PERMISSION_MANAGE, registerQbitRoutes } from './routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(__dirname, '..', 'manifest.json');

export async function register(ctx: PluginContext) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));

  ctx.registerPluginPermission(PERMISSION_VIEW, 'View qBittorrent queue and transfer stats');
  ctx.registerPluginPermission(PERMISSION_MANAGE, 'Pause, resume, delete and add torrents');
  ctx.registerRoutePermission('GET:/api/plugins/qbittorrent-manager/torrents', { permission: PERMISSION_VIEW });
  ctx.registerRoutePermission('GET:/api/plugins/qbittorrent-manager/transfer', { permission: PERMISSION_VIEW });
  ctx.registerRoutePermission('GET:/api/plugins/qbittorrent-manager/status', { permission: PERMISSION_VIEW });
  ctx.registerRoutePermission('GET:/api/plugins/qbittorrent-manager/imports', { permission: PERMISSION_VIEW });
  ctx.registerRoutePermission('POST:/api/plugins/qbittorrent-manager/torrents/pause', { permission: PERMISSION_MANAGE });
  ctx.registerRoutePermission('POST:/api/plugins/qbittorrent-manager/torrents/resume', { permission: PERMISSION_MANAGE });
  ctx.registerRoutePermission('POST:/api/plugins/qbittorrent-manager/torrents/delete', { permission: PERMISSION_MANAGE });
  ctx.registerRoutePermission('POST:/api/plugins/qbittorrent-manager/torrents/add-magnet', { permission: PERMISSION_MANAGE });

  const registerRoutes: RegisterRoutes = async (app) => {
    await registerQbitRoutes(app, ctx);
  };

  return {
    manifest,
    async registerRoutes(app: Parameters<RegisterRoutes>[0]) {
      await registerRoutes(app, ctx);
    },
  };
}
