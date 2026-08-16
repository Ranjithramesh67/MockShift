'use client';

import type { ApiRequest, ApiType, BodyType, HttpMethod, RequestContentType } from '@/lib/types';

export const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const API_TYPES: ApiType[] = ['REST', 'SOAP', 'GRAPHQL', 'AUTH'];

export const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: '#1f6feb',
  POST: '#2ea043',
  PUT: '#9e6a03',
  PATCH: '#8957e5',
  DELETE: '#da3633',
  HEAD: '#6b7684',
  OPTIONS: '#6b7684',
};

export type BodyKind = 'NONE' | 'JSON' | 'XML' | 'FORM_URLENCODED' | 'MULTIPART' | 'GRAPHQL' | 'RAW_TEXT';

export const BODY_KIND_OPTIONS: Array<{ id: BodyKind; label: string }> = [
  { id: 'NONE', label: 'None' },
  { id: 'JSON', label: 'JSON' },
  { id: 'XML', label: 'XML' },
  { id: 'FORM_URLENCODED', label: 'Form' },
  { id: 'MULTIPART', label: 'Multipart' },
  { id: 'GRAPHQL', label: 'GraphQL' },
  { id: 'RAW_TEXT', label: 'Raw' },
];

export function bodyKindOf(request: { bodyType: string; contentType: string }): BodyKind {
  if (request.bodyType === 'NONE') return 'NONE';
  if (request.bodyType === 'JSON') return 'JSON';
  if (request.bodyType === 'MULTIPART') return 'MULTIPART';
  if (request.bodyType === 'FORM_URLENCODED') return 'FORM_URLENCODED';
  if (request.bodyType === 'GRAPHQL') return 'GRAPHQL';
  if (request.contentType.includes('xml')) return 'XML';
  return 'RAW_TEXT';
}

export function bodyTypeForKind(kind: BodyKind): { bodyType: BodyType; contentType: RequestContentType } {
  switch (kind) {
    case 'JSON':
      return { bodyType: 'JSON', contentType: 'application/json' };
    case 'XML':
      return { bodyType: 'RAW_TEXT', contentType: 'application/xml' };
    case 'FORM_URLENCODED':
      return { bodyType: 'FORM_URLENCODED', contentType: 'application/x-www-form-urlencoded' };
    case 'MULTIPART':
      return { bodyType: 'MULTIPART', contentType: 'multipart/form-data' };
    case 'GRAPHQL':
      return { bodyType: 'GRAPHQL', contentType: 'application/json' };
    case 'RAW_TEXT':
      return { bodyType: 'RAW_TEXT', contentType: 'text/plain' };
    default:
      return { bodyType: 'NONE', contentType: 'text/plain' };
  }
}

export type { ApiRequest };
