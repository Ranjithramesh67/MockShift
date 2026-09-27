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
  requestSchema?: unknown;
  responseSchema?: unknown;
  responseType?: string | null;
  statusCode?: number | null;
  formula?: string | null;
  formulaSuggestions?: FormulaSuggestion[];
}

export interface Expects {
  status?: number;
  json?: Record<string, string | number | boolean>;
  headers?: Record<string, string>;
  responseTimeMs?: number;
}

export interface Assertion {
  id: string;
  type: 'status' | 'jsonPath' | 'header' | 'responseTime';
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt';
  path?: string;
  expected?: string;
}

export interface FormulaSuggestion {
  title: string;
  code: string;
  reason: string;
}

export interface CaptureOptions {
  enabled?: boolean;
  requestBodies?: boolean;
  responseBodies?: boolean;
  maxEvents?: number;
  maxBodyBytes?: number;
}

export interface AssertionOptions {
  status?: boolean;
  json?: boolean;
  suggest?: boolean;
  formulas?: boolean;
  responseTime?: boolean;
  maxResponseTimeMs?: number | null;
  maxTopLevelFields?: number;
}

export interface PathRule {
  pattern: string;
  replacement?: string;
  flags?: string;
}

export interface MockshiftOptions {
  apiKey?: string;
  token?: string;
  configFile?: string;
  config?: Record<string, unknown>;
  file?: boolean;
  baseUrl?: string;
  project?: string;
  workspace?: string;
  collection?: string;
  targetBaseUrl?: string;
  folder?: string | ((route: RouteInput) => string);
  structure?: Record<string, string>;
  include?: string[];
  exclude?: string[];
  pathRules?: PathRule[];
  capture?: CaptureOptions;
  assertions?: AssertionOptions;
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

export interface Observation {
  method: string;
  path: string;
  template?: string;
  status?: number;
  durationMs?: number;
  apiType?: string;
  responseType?: string | null;
  query?: Record<string, unknown> | null;
  requestBody?: unknown;
  responseBody?: unknown;
  responseText?: string | null;
}

export declare class Mockshift {
  constructor(options?: MockshiftOptions);
  config: Record<string, unknown>;
  routes: RouteInput[];
  register(route: RouteInput): this;
  test(key: string, expects: Expects): this;
  record(observation: Observation): this;
  inspect(): unknown;
  manifest(): unknown;
  sync(): Promise<SyncResult>;
  syncSoon(): this;
  express(app: unknown, options?: MockshiftOptions): this;
  http(server: unknown): this;
  middleware(): (req: unknown, res: unknown, next: (err?: unknown) => void) => void;
}

export declare const ApiHub: typeof Mockshift;
export declare function createHub(options?: MockshiftOptions): Mockshift;
export declare function attach(app: unknown, options?: MockshiftOptions): Mockshift;
export declare function attachHttp(server: unknown, options?: MockshiftOptions): Mockshift;
export declare class MockshiftError extends Error {
  status?: number;
  body?: unknown;
}
export declare class MockshiftConfigError extends MockshiftError {}
export declare const ApiHubError: typeof MockshiftError;
export declare const ApiHubConfigError: typeof MockshiftConfigError;
