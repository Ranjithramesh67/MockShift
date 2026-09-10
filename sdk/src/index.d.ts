export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface RouteInput {
  method: HttpMethod | string;
  path: string;
  key?: string;
  name?: string;
  folder?: string;
  headers?: Array<{ key: string; value: string; enabled?: boolean }>;
  queryParams?: Array<{ key: string; value: string; enabled?: boolean }>;
  bodyType?: string;
  bodyJson?: unknown;
  bodyText?: string | null;
  apiType?: string;
  assertions?: unknown[];
  sourceFile?: string | null;
}

export interface Expects {
  status?: number;
  json?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  responseTimeMs?: number;
}

export interface ApiHubOptions {
  apiKey?: string;
  baseUrl?: string;
  project?: string;
  workspace?: string;
  collection?: string;
  targetBaseUrl?: string;
  folder?: string | ((route: RouteInput) => string);
  structure?: Record<string, string>;
  include?: string[];
  exclude?: string[];
  autoSync?: boolean;
  prune?: boolean;
  timeoutMs?: number;
  onError?: (err: Error) => void;
}

export interface SyncResult {
  summary: {
    collectionId?: string;
    collections: { created: number };
    folders: { created: number; updated: number };
    requests: { created: number; updated: number; pruned: number };
  };
  projectId: string;
  collectionId: string;
}

export declare class ApiHub {
  constructor(options?: ApiHubOptions);
  register(route: RouteInput): this;
  test(key: string, expects: Expects): this;
  manifest(): unknown;
  sync(): Promise<SyncResult>;
  syncSoon(): this;
  express(app: unknown, options?: ApiHubOptions): this;
}

export declare function createHub(options?: ApiHubOptions): ApiHub;
export declare function attach(app: unknown, options?: ApiHubOptions): ApiHub;
export declare class ApiHubError extends Error {
  status?: number;
  body?: unknown;
}
export declare class ApiHubConfigError extends ApiHubError {}
