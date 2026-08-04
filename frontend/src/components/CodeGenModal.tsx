'use client';

import React, { useMemo, useState } from 'react';
import type { ApiRequest } from '@/lib/types';
import { useApp } from '@/store/AppStore';
import { CODE_LANGS, generateCode, type CodeGenRequest, type CodeLang } from '@/lib/codegen';
import { generateCurl } from '@/lib/curl';
import { CopyIcon, CheckIcon, XIcon, CodeIcon } from './icons';

function toCodeGenRequest(request: ApiRequest): CodeGenRequest {
  return {
    method: request.method,
    url: request.url,
    headers: request.headers,
    queryParams: request.queryParams,
    bodyType: request.bodyType,
    bodyJson: request.bodyJson,
    bodyText: request.bodyText,
    contentType: request.contentType,
  };
}

export function CodeGenModal({ request, onClose }: { request: ApiRequest; onClose: () => void }) {
  const { dispatch } = useApp();
  const [lang, setLang] = useState<CodeLang | 'curl'>('nodejs');
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    if (lang === 'curl') {
      return generateCurl(request);
    }
    return generateCode(lang, toCodeGenRequest(request));
  }, [lang, request]);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Code copied to clipboard.' });
    } catch {
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: 'Clipboard unavailable.' });
    }
  };

  const allLangs: Array<{ id: CodeLang | 'curl'; label: string }> = [
    { id: 'curl', label: 'cURL' },
    ...CODE_LANGS,
  ];

  return (
    <div className="modal-overlay" data-testid="codegen-modal" onClick={onClose}>
      <div className="codegen-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            <CodeIcon size={15} />
            Generate code
          </span>
          <button type="button" className="ghost-button icon-only" aria-label="Close" data-testid="codegen-close" onClick={onClose}>
            <XIcon size={14} />
          </button>
        </div>
        <div className="codegen-body">
          <div className="codegen-langs" data-testid="codegen-langs">
            {allLangs.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`codegen-lang ${lang === l.id ? 'active' : ''}`}
                data-testid={`codegen-lang-${l.id}`}
                onClick={() => setLang(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="codegen-pane">
            <div className="codegen-toolbar">
              <span className="hint">{lang === 'curl' ? 'Shell (curl)' : CODE_LANGS.find((l) => l.id === lang)?.label}</span>
              <button type="button" className="ghost-button small" data-testid="codegen-copy" onClick={copy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="codegen-code" data-testid="codegen-code">
              <code>{code}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
