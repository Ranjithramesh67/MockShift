'use client';

import React from 'react';
import { CodeEditor } from './CodeEditor';
import { parseGraphqlBody, serializeGraphqlBody } from '@/lib/graphqlBody';

export function GraphqlBodyEditor({
  value,
  onChange,
  onModEnter,
}: {
  value: string | null | undefined;
  onChange: (bodyJson: string) => void;
  onModEnter?: () => void;
}) {
  const gql = parseGraphqlBody(value ?? '');
  const write = (patch: { query?: string; variables?: string }) =>
    onChange(serializeGraphqlBody({ ...gql, ...patch }));
  return (
    <div className="graphql-editor" data-testid="graphql-editor">
      <div data-testid="graphql-query-editor" style={{ height: '55%' }}>
        <CodeEditor
          value={gql.query}
          onChange={(v) => write({ query: v })}
          language="text"
          height="100%"
          ariaLabel="GraphQL query"
          onModEnter={onModEnter}
        />
      </div>
      <div data-testid="graphql-variables-editor" style={{ height: '45%' }}>
        <CodeEditor
          value={gql.variables}
          onChange={(v) => write({ variables: v })}
          language="json"
          height="100%"
          ariaLabel="GraphQL variables"
          onModEnter={onModEnter}
        />
      </div>
    </div>
  );
}
