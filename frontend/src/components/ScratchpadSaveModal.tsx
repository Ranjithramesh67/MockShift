'use client';

import React, { useState } from 'react';
import type { Folder } from '@/lib/api';
import { contentApi } from '@/lib/api';
import { useApp } from '@/store/AppStore';
import { useWorkspace } from '@/store/WorkspaceStore';
import { scratchDraftToServerPatch } from '@/lib/scratchpadDraft';
import { Modal } from './Modal';

type ScratchpadDraft = {
  method: string;
  url: string;
  apiType: string;
  headers: unknown[];
  queryParams: unknown[];
  bodyType: string;
  bodyJson: unknown;
  bodyText: string | null;
  formula: string;
  assertions: unknown[];
  contentType: string;
};

type SelectedLocation = { collectionId: string; folderId: string | null } | null;

/**
 * M14: save-location picker for the scratchpad. Prompts for a request name and a
 * target collection (with an optional nested folder), then persists the scratchpad
 * draft as a real saved request via contentApi.createRequest + updateRequest.
 */
export function ScratchpadSaveModal({
  open,
  draft,
  onClose,
  onSaved,
}: {
  open: boolean;
  draft: ScratchpadDraft;
  onClose: () => void;
  onSaved: (requestId: string) => void;
}) {
  const { dispatch } = useApp();
  const ws = useWorkspace();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<SelectedLocation>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  // Build parent_id -> children lookup per collection for the nested folder tree.
  const foldersByParent = new Map<string, Map<string | null, Folder[]>>();
  for (const f of ws.tree?.folders ?? []) {
    if (!foldersByParent.has(f.collection_id)) foldersByParent.set(f.collection_id, new Map());
    const byParent = foldersByParent.get(f.collection_id)!;
    if (!byParent.has(f.parent_id)) byParent.set(f.parent_id, []);
    byParent.get(f.parent_id)!.push(f);
  }

  const renderFolders = (collectionId: string, parentId: string | null, depth: number): React.ReactNode => {
    const children = foldersByParent.get(collectionId)?.get(parentId) ?? [];
    return (
      <>
        {children.map((folder) => {
          const isFolderSelected = selected?.collectionId === collectionId && selected?.folderId === folder.id;
          return (
            <React.Fragment key={folder.id}>
              <button
                type="button"
                data-testid={`scratchpad-save-folder-${folder.id}`}
                className={`scratchpad-save-location-row ${isFolderSelected ? 'selected' : ''}`}
                style={{ paddingLeft: 16 + depth * 16 }}
                onClick={() => setSelected({ collectionId, folderId: folder.id })}
              >
                <span className="scratchpad-save-location-mark">{isFolderSelected ? '✓' : ''}</span>
                {folder.name}
              </button>
              {renderFolders(collectionId, folder.id, depth + 1)}
            </React.Fragment>
          );
        })}
      </>
    );
  };

  const onSave = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: 'Name is required' });
      return;
    }
    if (!selected) {
      setError('Pick a collection to save into.');
      dispatch({ type: 'SHOW_TOAST', kind: 'error', message: 'Pick a collection to save into.' });
      return;
    }
    setBusy(true);
    try {
      const { request } = await contentApi.createRequest({
        collectionId: selected.collectionId,
        name: name.trim(),
        method: draft.method,
        url: draft.url,
        apiType: draft.apiType as 'REST' | 'SOAP' | 'GRAPHQL' | 'AUTH',
        folderId: selected.folderId,
      });
      await contentApi.updateRequest(request.id, scratchDraftToServerPatch(draft));
      await ws.reloadTree();
      await ws.selectRequest(request.id);
      onSaved(request.id);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Save failed';
      setError(raw.startsWith('Save failed') ? raw : `Save failed: ${raw}`);
      dispatch({
        type: 'SHOW_TOAST',
        kind: 'error',
        message: raw.startsWith('Save failed') ? raw : `Save failed: ${raw}`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Save request" onClose={onClose} testId="scratchpad-save-modal">
      <form className="modal-form" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
        <p className="hint">
          Name is required; pick a collection to save into — folders are optional.
        </p>
        <label className="auth-field">
          <span>Request name</span>
          <input
            type="text"
            autoFocus
            data-testid="scratchpad-save-name"
            placeholder="Request name"
            aria-label="Request name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="auth-field">
          <span>Location</span>
          <div className="scratchpad-save-location" data-testid="scratchpad-save-location">
            {!ws.tree || ws.tree.collections.length === 0 ? (
              <p className="hint">No collections in this workspace yet.</p>
            ) : (
              ws.tree.collections.map((col) => {
                const isColSelected = selected?.collectionId === col.id && selected?.folderId === null;
                return (
                  <div key={col.id} className="scratchpad-save-col">
                    <button
                      type="button"
                      data-testid={`scratchpad-save-col-${col.id}`}
                      className={`scratchpad-save-location-row ${isColSelected ? 'selected' : ''}`}
                      onClick={() => setSelected({ collectionId: col.id, folderId: null })}
                    >
                      <span className="scratchpad-save-location-mark">{isColSelected ? '✓' : ''}</span>
                      {col.name}
                    </button>
                    {renderFolders(col.id, null, 0)}
                  </div>
                );
              })
            )}
          </div>
        </div>
        {error && (
          <div className="validation-banner" data-testid="scratchpad-save-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost-button" data-testid="scratchpad-save-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={busy}
            data-testid="scratchpad-save-confirm"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
