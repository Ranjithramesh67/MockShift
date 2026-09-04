'use client';

import React, { useEffect, useState } from 'react';
import type { Assertion, BodyFormPart, HttpMethod, KeyValueEntry } from '@/lib/types';
import { useApp } from '@/store/AppStore';
import { useWorkspace } from '@/store/WorkspaceStore';
import { isCurlCommand, parseCurl } from '@/lib/curl';
import { seedPartsFromLegacy, readFileAsBase64 } from '@/lib/multipartParts';
import {
  METHODS,
  METHOD_COLORS,
  BODY_KIND_OPTIONS,
  bodyKindOf,
  bodyTypeForKind,
  type BodyKind,
} from '@/lib/requestForm';
import { defaultScratchDraft, scratchDraftToRunInput } from '@/lib/scratchpadDraft';
import { TabBar } from './TabBar';
import { KeyValueRows } from './KeyValueRows';
import { MultipartRows } from './MultipartRows';
import { CodeEditor } from './CodeEditor';
import { FormulaHelper } from './FormulaHelper';
import { AssertionsEditor } from './AssertionsEditor';
import { SplitPane } from './SplitPane';
import { ResponsePane } from './ResponsePane';
import { ScratchpadSaveModal } from './ScratchpadSaveModal';
import { SendIcon, SaveIcon, XIcon, RowsIcon, ListIcon, CodeIcon, FormulaIcon, CheckIcon } from './icons';

type ScratchTab = 'params' | 'headers' | 'body' | 'formula' | 'tests';

interface ScratchDraft {
  method: HttpMethod;
  url: string;
  headers: KeyValueEntry[];
  queryParams: KeyValueEntry[];
  bodyType: string;
  bodyJson: string | null;
  bodyText: string | null;
  contentType: string;
  apiType: string;
  formula: string;
  assertions: Assertion[];
  bodyParts?: BodyFormPart[];
}

/**
 * M14: full-width scratchpad — a request-editor pane that runs an in-memory
 * request without creating or saving anything. The draft lives entirely in
 * local state (never the store working copy); Send executes it via the
 * ephemeral `POST /api/runs` endpoint and Save opens the save modal.
 */
export function ScratchpadWorkspace({ onClose }: { onClose: () => void }) {
  const { dispatch } = useApp();
  const ws = useWorkspace();
  const [draft, setDraft] = useState<ScratchDraft>(() => {
    const initial = defaultScratchDraft() as ScratchDraft;
    return { ...initial, bodyParts: initial.bodyParts ?? [] };
  });
  const [activeTab, setActiveTab] = useState<ScratchTab>('params');
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  // [partId] -> chosen File for the current scratchpad draft. Browser File
  // objects never live inside the draft/bodyParts — only here in memory, so
  // the draft stays serializable for the save modal and history.
  const [files, setFiles] = useState<Record<string, File>>({});

  // Clear any previous scratchpad run so the response pane starts empty.
  useEffect(() => {
    ws.clearScratchpadRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<ScratchDraft>) => setDraft((prev) => ({ ...prev, ...patch }));

  const onUrlChange = (value: string) => {
    // Pasting a curl command into the URL field overwrites the draft with the
    // parsed method, headers, query params and body.
    if (isCurlCommand(value)) {
      const parsed = parseCurl(value);
      if (parsed.url) {
        update({
          method: parsed.method,
          url: parsed.url,
          headers: parsed.headers,
          queryParams: parsed.queryParams,
          bodyType: parsed.bodyType,
          bodyJson: parsed.bodyJson ?? parsed.bodyText ?? null,
          bodyText: parsed.bodyText ?? null,
          contentType: parsed.contentType,
          ...(parsed.bodyType === 'MULTIPART'
            ? { bodyParts: seedPartsFromLegacy(parsed.bodyText ?? '') }
            : {}),
        });
        dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'cURL parsed into the request.' });
        return;
      }
    }
    update({ url: value });
  };

  const updateKeyValue = (field: 'headers' | 'queryParams', entries: KeyValueEntry[]) => {
    update({ [field]: entries } as Partial<ScratchDraft>);
  };

  const bodyKind = bodyKindOf(draft);

  const onBodyKindChange = (kind: BodyKind) => {
    const next = bodyTypeForKind(kind);
    if (kind === 'MULTIPART') {
      update({
        bodyType: next.bodyType,
        contentType: next.contentType,
        bodyJson: null,
        bodyParts: draft.bodyParts?.length
          ? draft.bodyParts
          : seedPartsFromLegacy(draft.bodyText ?? ''),
      });
    } else {
      update({
        bodyType: next.bodyType,
        contentType: next.contentType,
        bodyJson: kind === 'NONE' ? null : draft.bodyJson ?? '',
      });
    }
  };

  const onSend = async () => {
    const parts = draft.bodyParts ?? [];
    if (draft.bodyType === 'MULTIPART') {
      const missing = parts.find(
        (p) => p.kind === 'file' && p.enabled !== false && p.key && !files[p.id]
      );
      if (missing) {
        dispatch({
          type: 'SHOW_TOAST',
          kind: 'error',
          message: `Select a file for multipart part "${missing.key}" before sending.`,
        });
        return;
      }
    }
    setBusy(true);
    try {
      const runInput: Record<string, unknown> = { ...scratchDraftToRunInput(draft) };
      if (draft.bodyType === 'MULTIPART') {
        const bodyParts: BodyFormPart[] = [];
        for (const p of parts) {
          if (p.kind === 'file' && p.enabled !== false && p.key) {
            const file = files[p.id];
            bodyParts.push({
              ...p,
              data: await readFileAsBase64(file),
              fileName: file.name,
              fileType: file.type || undefined,
              fileSize: file.size,
            });
          } else {
            bodyParts.push(p);
          }
        }
        runInput.bodyParts = bodyParts;
      }
      await ws.runScratchpad(runInput as Parameters<typeof ws.runScratchpad>[0]);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Scratchpad request executed (nothing saved).' });
    } catch (err) {
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: err instanceof Error ? err.message : 'Run failed' });
    } finally {
      setBusy(false);
    }
  };

  const actionBtn = { display: 'inline-flex', alignItems: 'center', gap: 6 } as const;

  return (
    <div className="scratchpad-workspace" data-testid="scratchpad-workspace">
      <div className="request-bar">
        <select
          className="method-select"
          value={draft.method}
          aria-label="Method"
          data-testid="scratchpad-method"
          style={{ color: METHOD_COLORS[draft.method] }}
          onChange={(e) => update({ method: e.target.value as HttpMethod })}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="url-input"
          type="text"
          value={draft.url}
          placeholder="https://api.example.com/path  ·  or paste a curl command"
          spellCheck={false}
          aria-label="Request URL"
          data-testid="scratchpad-url"
          onChange={(e) => onUrlChange(e.target.value)}
        />
        <button
          type="button"
          className="primary-button"
          data-testid="scratchpad-send"
          onClick={onSend}
          disabled={busy}
          title={busy ? 'Running…' : 'Send'}
          style={actionBtn}
        >
          {busy ? <span className="spinner spinner-sm" /> : <SendIcon size={14} />}
          Send
        </button>
        <button type="button" className="ghost-button" data-testid="scratchpad-save" onClick={() => setSaveOpen(true)} style={actionBtn}>
          <SaveIcon size={14} />
          Save
        </button>
        <button type="button" className="ghost-button" data-testid="scratchpad-close" onClick={onClose} style={actionBtn}>
          <XIcon size={14} />
          Close
        </button>
      </div>

      <TabBar
        tabs={[
          { id: 'params', label: 'Params', icon: RowsIcon },
          { id: 'headers', label: 'Headers', icon: ListIcon },
          { id: 'body', label: 'Body', icon: CodeIcon },
          { id: 'formula', label: 'Formula', icon: FormulaIcon },
          { id: 'tests', label: 'Tests', icon: CheckIcon },
        ]}
        active={activeTab}
        onChange={(tab) => setActiveTab(tab)}
        testIdPrefix="scratchpad"
      />

      <SplitPane
        orientation="horizontal"
        top={
          <div className="request-tab-body">
            {activeTab === 'params' && (
              <KeyValueRows
                entries={draft.queryParams}
                onChange={(queryParams) => updateKeyValue('queryParams', queryParams)}
                keyPlaceholder="e.g. include"
                valuePlaceholder="e.g. line_items"
                testIdPrefix="params"
              />
            )}
            {activeTab === 'headers' && (
              <KeyValueRows
                entries={draft.headers}
                onChange={(headers) => updateKeyValue('headers', headers)}
                keyPlaceholder="e.g. Authorization"
                valuePlaceholder="e.g. Bearer {{token}}"
                testIdPrefix="headers"
              />
            )}
            {activeTab === 'body' && (
              <div className="body-editor" data-testid="body-editor">
                <div className="body-toolbar">
                  <select
                    className="compact-select"
                    aria-label="Body type"
                    data-testid="body-type-select"
                    value={bodyKind}
                    onChange={(e) => onBodyKindChange(e.target.value as BodyKind)}
                  >
                    {BODY_KIND_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                {bodyKind === 'NONE' ? (
                  <div className="panel-empty">This request has no body.</div>
                ) : bodyKind === 'MULTIPART' ? (
                  <MultipartRows
                    parts={draft.bodyParts ?? []}
                    onChange={(parts) => update({ bodyParts: parts })}
                    files={files}
                    onFileChange={(partId, file) =>
                      setFiles((prev) => {
                        const next = { ...prev };
                        if (file) next[partId] = file;
                        else delete next[partId];
                        return next;
                      })
                    }
                  />
                ) : (
                  <CodeEditor
                    value={draft.bodyJson ?? ''}
                    onChange={(value) => update({ bodyJson: value })}
                    language={bodyKind === 'JSON' || bodyKind === 'GRAPHQL' ? 'json' : bodyKind === 'XML' ? 'xml' : 'text'}
                    height="100%"
                    ariaLabel="Request body editor"
                    onModEnter={onSend}
                  />
                )}
              </div>
            )}
            {activeTab === 'formula' && (
              <div className="formula-editor">
                <CodeEditor
                  value={draft.formula}
                  onChange={(value) => update({ formula: value })}
                  language="javascript"
                  height="100%"
                  ariaLabel="Formula editor"
                  onModEnter={onSend}
                />
                <FormulaHelper
                  onInsert={(code) => {
                    const current = draft.formula;
                    update({ formula: current ? `${current}\n${code}` : code });
                  }}
                />
              </div>
            )}
            {activeTab === 'tests' && (
              <AssertionsEditor
                assertions={draft.assertions}
                onChange={(assertions) => update({ assertions })}
              />
            )}
          </div>
        }
        bottom={<ResponsePane />}
      />
      {saveOpen && (
        <ScratchpadSaveModal
          open={saveOpen}
          draft={draft}
          onClose={() => setSaveOpen(false)}
          onSaved={(requestId) => {
            setSaveOpen(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}
