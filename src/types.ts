import type { FastifyInstance } from 'fastify';

export interface PluginLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export interface PluginContext {
  log: PluginLogger;
  getSetting(key: string): Promise<unknown>;
  setSetting(key: string, value: unknown): Promise<void>;
  registerPluginPermission(permission: string, description?: string): void;
  registerRoutePermission(routeKey: string, rule: { permission: string; ownerScoped?: boolean }): void;
  getServiceConfigRaw(serviceType: string): Promise<Record<string, unknown> | null>;
}

export interface QbitConfig {
  url: string;
  username: string;
  password: string;
}

export interface QbitTorrent {
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

export interface QbitTransferInfo {
  dl_info_speed: number;
  dl_info_data: number;
  up_info_speed: number;
  up_info_data: number;
  dl_rate_limit: number;
  up_rate_limit: number;
  connection_status: string;
}

export type RegisterRoutes = (app: FastifyInstance, ctx: PluginContext) => Promise<void> | void;
