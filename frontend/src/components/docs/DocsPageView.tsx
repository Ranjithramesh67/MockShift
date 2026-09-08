'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useApp } from '@/store/AppStore';
import { useWorkspace } from '@/store/WorkspaceStore';
import {
  blockToPayload,
  docsApi,
  isApiError,
  stripPositions,
  type DocsBlock,
  type DocsMention,
  type DocsPageDetail,
} from '@/lib/docsApi';
import { ApiPickerModal, UserPickerModal } from './Pickers';
import { BlocksEditor } from './BlockEditor';
import { BlockView, MentionChips } from './Mentions';
import { DocShareButton, ExportMenu } from './PageActions';
import { fmtDate, workspaceRoleRank } from './helpers';
import styles from './docs.module.css';
import { BackIcon, TrashIcon, UserIcon, ServerIcon, SaveIcon, XIcon, PencilIcon } from '@/components/icons';

function blocksEqual(a: DocsBlock[], b: DocsBlock[]): boolean {
  return JSON.stringify(a.map(blockToPayload)) === JSON.stringify(b.map(blockToPayload));
}

export function DocsPageView({
  pageId,
  onBack,
  onOpenApi,
}: {
  pageId: string;
  onBack: () => void;
  onOpenApi: (mention: DocsMention) => void;
}) {
  const { dispatch } = useApp();
  const { user } = useAuth();
  const ws = useWorkspace();
  const [detail, setDetail] = useState<DocsPageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [blocksDraft, setBlocksDraft] = useState<DocsBlock[]>([]);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<null | 'user' | 'api'>(null);
  const [mentionsBusy, setMentionsBusy] = useState(false);

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError('');
    try {
      const d = await docsApi.get(pageId);
      setDetail(d);
      setTitleDraft(d.page.title);
      setBlocksDraft(stripPositions(d.blocks));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load page');
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [pageId]);

  useEffect(() => {
    load();
  }, [load]);

  const workspaceRole = ws.workspaces.find((w) => w.id === detail?.page.workspaceId)?.role ?? null;
  const isAuthor = detail?.page.createdBy?.id === user?.id;
  const canDelete =
    !!detail &&
    (isAuthor || workspaceRoleRank(workspaceRole) >= 4 || workspaceRoleRank(user?.role ?? null) >= 3);

  const dirty = useMemo(() => {
    if (!detail) return false;
    const titleChanged = titleDraft.trim() !== detail.page.title.trim();
    const blocksChanged = !blocksEqual(blocksDraft, stripPositions(detail.blocks));
    return titleChanged || blocksChanged;
  }, [detail, titleDraft, blocksDraft]);

  const exitGuard = useCallback((): boolean => {
    if (editing && dirty) {
      return window.confirm('Discard unsaved changes to this page?');
    }
    return true;
  }, [editing, dirty]);

  const handleBack = () => {
    if (exitGuard()) onBack();
  };

  const toggleEdit = () => {
    if (editing) {
      // Leave without saving — restore canonical content.
      if (!exitGuard()) return;
      if (!detail) return;
      setTitleDraft(detail.page.title);
      setBlocksDraft(stripPositions(detail.blocks));
      setEditing(false);
    } else if (detail?.page.canEdit) {
      setTitleDraft(detail.page.title);
      setBlocksDraft(stripPositions(detail.blocks));
      setEditing(true);
    }
  };

  const save = async () => {
    if (!detail) return;
    setSaving(true);
    setError('');
    try {
      const trimmedTitle = titleDraft.trim();
      const titleChanged = trimmedTitle !== detail.page.title.trim();
      const blocksChanged = !blocksEqual(blocksDraft, stripPositions(detail.blocks));
      if (!titleChanged && !blocksChanged) {
        setEditing(false);
        return;
      }
      if (titleChanged) {
        const { page } = await docsApi.updateTitle(pageId, trimmedTitle);
        setDetail((d) => (d ? { ...d, page: { ...d.page, title: page.title, updatedAt: page.updatedAt } } : d));
      }
      if (blocksChanged) {
        const { blocks } = await docsApi.saveBlocks(pageId, blocksDraft);
        setDetail((d) => (d ? { ...d, blocks, page: { ...d.page, updatedAt: blocks[0] ? d.page.updatedAt : d.page.updatedAt } } : d));
        setBlocksDraft(stripPositions(blocks));
      }
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Page saved.' });
      await load(false);
    } catch (err) {
      dispatch({
        type: 'SHOW_TOAST',
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to save page',
      });
    } finally {
      setSaving(false);
    }
  };

  const removePage = async () => {
    if (!detail) return;
    if (!window.confirm(`Delete "${detail.page.title}"? This cannot be undone.`)) return;
    setError('');
    try {
      await docsApi.remove(pageId);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Page deleted.' });
      onBack();
    } catch (err) {
      dispatch({
        type: 'SHOW_TOAST',
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete page',
      });
    }
  };

  const addMention = async (type: 'user' | 'api', refId: string) => {
    setPicker(null);
    setMentionsBusy(true);
    try {
      const { mention } = await docsApi.addMention(pageId, { type, refId });
      setDetail((d) => (d ? { ...d, mentions: [...d.mentions, mention] } : d));
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: type === 'user' ? 'User tagged.' : 'API tagged.' });
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        dispatch({ type: 'SHOW_TOAST', kind: 'info', message: 'That mention already exists on this page.' });
      } else {
        dispatch({
          type: 'SHOW_TOAST',
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to add mention',
        });
      }
    } finally {
      setMentionsBusy(false);
    }
  };

  const removeMention = async (mentionId: string) => {
    setMentionsBusy(true);
    try {
      await docsApi.removeMention(pageId, mentionId);
      setDetail((d) => (d ? { ...d, mentions: d.mentions.filter((m) => m.id !== mentionId) } : d));
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Mention removed.' });
    } catch (err) {
      if (isApiError(err) && err.status === 404) {
        // Already gone on the server — refresh silently.
        await load(false);
      } else {
        dispatch({
          type: 'SHOW_TOAST',
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to remove mention',
        });
      }
    } finally {
      setMentionsBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-screen" data-testid="docs-loading">
        <span className="spinner" />
        <p>Loading page…</p>
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="panel-empty" data-testid="docs-error">
        <p>{error}</p>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onBack}>
            Back to docs
          </button>
          <button type="button" className="primary-button" onClick={() => load()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const canEdit = detail.page.canEdit;
  const mentionedApiOpen = (mention: DocsMention) => onOpenApi(mention);

  return (
    <div className={styles.docColumn} data-testid="docs-page">
      <div className={styles.docsHeader}>
        <div>
          <button type="button" className="ghost-button small" data-testid="docs-back" onClick={handleBack}>
            <BackIcon size={13} />
            All docs
          </button>
        </div>
        <div className="admin-header-actions">
          {canEdit && !editing && (
            <button type="button" className="ghost-button" data-testid="docs-edit" onClick={toggleEdit}>
              <PencilIcon size={13} />
              Edit
            </button>
          )}
          {!editing && (
            <>
              <ExportMenu pageId={pageId} title={detail.page.title} />
              <DocShareButton pageId={pageId} />
            </>
          )}
          {editing && (
            <>
              <button type="button" className="ghost-button" data-testid="docs-cancel-edit" disabled={saving} onClick={toggleEdit}>
                <XIcon size={13} />
                Cancel
              </button>
              <button type="button" className="primary-button" data-testid="docs-save" disabled={saving || !dirty || !titleDraft.trim()} onClick={save}>
                <SaveIcon size={13} />
                {saving ? 'Saving…' : 'Save page'}
              </button>
            </>
          )}
          {canDelete && !editing && (
            <button type="button" className="ghost-button danger" data-testid="docs-delete" onClick={removePage}>
              <TrashIcon size={13} />
              Delete
            </button>
          )}
        </div>
      </div>

      {editing ? (
        <input
          className={styles.pageTitleInput}
          data-testid="docs-page-title"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          placeholder="Page title"
          aria-label="Page title"
        />
      ) : (
        <h1 className={styles.docsHeaderTitle} data-testid="docs-page-title">
          {detail.page.title || 'Untitled page'}
        </h1>
      )}

      <p className={styles.docMetaLine}>
        {(detail.page.updatedBy ?? detail.page.createdBy)?.name ?? 'Unknown'} updated this{' '}
        <strong>{fmtDate(detail.page.updatedAt ?? detail.page.createdAt)}</strong>
        {detail.page.projectName && <span>· {detail.page.projectName}</span>}
        {!canEdit && <span className="role-badge">read-only</span>}
      </p>

      <div className={styles.docBody}>
        {editing ? (
          <BlocksEditor
            testId="docs-editor"
            blocks={blocksDraft}
            onChange={(next) => setBlocksDraft(next)}
          />
        ) : (
          <BlockView blocks={detail.blocks} />
        )}
      </div>

      <div className={styles.mentionSection}>
        <div className={styles.mentionSectionHead}>
          <span className={styles.sectionLabel}>Mentions</span>
          {editing && canEdit && (
            <div className={styles.mentionActions}>
              <button type="button" className="ghost-button small" data-testid="docs-tag-user" disabled={mentionsBusy} onClick={() => setPicker('user')}>
                <UserIcon size={13} />
                Tag user
              </button>
              <button type="button" className="ghost-button small" data-testid="docs-tag-api" disabled={mentionsBusy} onClick={() => setPicker('api')}>
                <ServerIcon size={13} />
                Tag API
              </button>
            </div>
          )}
        </div>
        {detail.mentions.length === 0 ? (
          <p className={styles.editorHint}>No mentions yet.</p>
        ) : (
          <MentionChips
            mentions={detail.mentions}
            mode={editing ? 'edit' : 'view'}
            onOpenApi={mentionedApiOpen}
            onRemove={editing ? removeMention : undefined}
          />
        )}
      </div>

      {picker === 'user' && detail && (
        <UserPickerModal
          workspaceId={detail.page.workspaceId}
          onClose={() => setPicker(null)}
          onPick={(userId) => addMention('user', userId)}
        />
      )}
      {picker === 'api' && detail && (
        <ApiPickerModal
          workspaceId={detail.page.workspaceId}
          onClose={() => setPicker(null)}
          onPick={(requestId) => addMention('api', requestId)}
        />
      )}
    </div>
  );
}
