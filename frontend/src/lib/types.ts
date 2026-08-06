export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

export type ApiType = 'REST' | 'SOAP' | 'GRAPHQL' | 'AUTH';

export type BodyType = 'NONE' | 'JSON' | 'FORM_URLENCODED' | 'MULTIPART' | 'RAW_TEXT' | 'GRAPHQL';

export type RequestContentType =
  | 'application/json'
  | 'application/xml'
  | 'application/x-www-form-urlencoded'
  | 'text/plain'
  | 'multipart/form-data'
  | 'text/xml';

export interface KeyValueEntry {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValueEntry[];
  queryParams: KeyValueEntry[];
  bodyType: BodyType;
  bodyJson: string | null; // serialized JSON/XML/form text shown in the editor
  bodyText?: string | null; // raw text body captured by cURL import
  contentType: RequestContentType;
  formula: string; // pre-request / pre-step sandbox formula
  apiType: ApiType;
}

export type ViewMode = 'split' | 'side' | 'request' | 'response';

export interface MockResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** 'base64' when the upstream content-type is binary (PDF, images, …), otherwise 'text'. */
  bodyEncoding?: 'text' | 'base64';
  durationMs: number;
}

/**
 * Loop configuration for a workflow step.
 * - type 'count': run the step `count` times (count >= 1 required).
 * - type 'until': keep looping while `condition` evaluates truthy. The
 *   condition must reference an upstream step's result, never its own step,
 *   otherwise the loop can never terminate -> infinite loop.
 * - type 'none': no looping.
 */
export type LoopConfig =
  | { type: 'none' }
  | { type: 'count'; count: number }
  | { type: 'until'; condition: string };

export type FailurePolicy = 'abort' | 'skip';

/**
 * Pass a previous step's request or response value into this step's outgoing
 * request. `data: 'request'` / `'response'` selects which snapshot the value is
 * taken from; `field` is an optional dot path into it (e.g. 'id', 'headers.ct');
 * `target` says where to put the value (url query param / query / header / body);
 * `targetKey` names the destination key (defaults per-target).
 */
export type StepPassInputData = 'request' | 'response';
export type StepPassInputTarget = 'url' | 'query' | 'header' | 'body';

export interface StepPassInput {
  sourceStepId: string;
  data: StepPassInputData;
  field?: string;
  target: StepPassInputTarget;
  targetKey?: string;
}

export interface WorkflowStep {
  id: string; // stable client-side id (nanoid-like)
  label: string;
  requestId: string | null;
  delayMs: number;
  loop: LoopConfig;
  onFailure: FailurePolicy;
  formula: string;
  passInputs?: StepPassInput[];
}

export interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
}

export interface AppState {
  activeTab: 'request' | 'workflow';
  activeRequestId: string;
  requests: ApiRequest[];
  activeWorkflowId: string;
  workflows: Workflow[];
  activeRequestTab: 'params' | 'headers' | 'body' | 'formula';
  lastResponse: MockResponse | null;
  viewMode: ViewMode;
  toast: { id: number; kind: 'success' | 'error' | 'info'; message: string } | null;
}
