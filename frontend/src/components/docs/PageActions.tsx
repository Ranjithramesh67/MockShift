'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { useApp } from '@/store/AppStore';
import {
  docsApi,
  fetchDocExport,
  isApiError,
  type DocExportFormat,
  type DocsShareInfo,
} from '@/lib/docsApi';
import styles from './docs.module.css';
import { CheckIcon, ChevronIcon, CopyIcon, ExportIcon, ShareIcon } from '@/components/icons';

// File-name helper: slug of the page title plus the right extension.
function fileNameFor(title: string, ext: string): string {
  const slug = (title || 'doc')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'doc'}.${ext}`;
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): Promise<void> {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);
  return Promise.resolve();
}

const EXPORT_FORMATS: Array<{ format: DocExportFormat; label: string; desc: string }> = [
  { format: 'markdown', label: 'Markdown', desc: '.md file' },
  { format: 'html', label: 'HTML', desc: 'standalone page' },
  { format: 'word', label: 'Word', desc: '.doc file' },
  { format: 'json', label: 'JSON', desc: 'structured data' },
];

function mimeFor(format: DocExportFormat): string {
  if (format === 'markdown') return 'text/markdown';
  if (format === 'word') return 'application/msword';
  if (format === 'html') return 'text/html';
  return 'application/json';
}

export function ExportMenu({ pageId, title }: { pageId: string; title: string }) {
  const { dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<DocExportFormat | 'print' | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toastError = (err: unknown) => {
    dispatch({
      type: 'SHOW_TOAST',
      kind: 'error',
      message: err instanceof Error ? err.message : 'Failed to export page',
    });
  };

  const download = async (format: DocExportFormat) => {
    setBusy(format);
    setOpen(false);
    try {
      const text = await fetchDocExport(pageId, format);
      const ext = format === 'markdown' ? 'md' : format === 'word' ? 'doc' : format;
      const blob = new Blob([text], { type: `${mimeFor(format)};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileNameFor(title, ext);
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      dispatch({ type: 'SHOW_TOAST', kind: 'success', message: 'Page exported.' });
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  };

  const printHtml = async () => {
    setBusy('print');
    setOpen(false);
    try {
      const html = await fetchDocExport(pageId, 'html');
      const win = window.open('', '_blank');
      if (!win) {
        dispatch({ type: 'SHOW_TOAST', kind: 'error', message: 'Your browser blocked the print window.' });
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      window.setTimeout(() => {
        try {
          win.print();
        } catch {
          // Cross-origin / closed popup — nothing else we can do.
        }
      }, 400);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.actionMenuWrap} ref={wrapRef}>
      <button
        type="button"
        className="ghost-button"
        data-testid="docs-export"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <ExportIcon size={13} />
        Export
        <ChevronIcon size={12} />
      </button>
      {open && (
        <div className={styles.actionMenu} data-testid="docs-export-menu" role="menu">
          {EXPORT_FORMATS.map((item) => (
            <button
              key={item.format}
              type="button"
              role="menuitem"
              className={styles.actionMenuItem}
              data-testid={`docs-export-${item.format === 'markdown' ? 'md' : item.format}`}
              disabled={busy !== null}
              onClick={() => download(item.format)}
            >
              {item.label}
              <span className={styles.actionMenuHint}>{item.desc}</span>
            </button>
          ))}
          <div className={styles.actionMenuSep} />
          <button
            type="button"
            role="menuitem"
            className={styles.actionMenuItem}
            data-testid="docs-export-print"
            disabled={busy !== null}
            onClick={printHtml}
          >
            Print or save as PDF
            <span className={styles.actionMenuHint}>Themed document — choose “Save as PDF” in the print dialog</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function DocShareButton({ pageId, disabled = false }: { pageId: string; disabled?: boolean }) {
  const { dispatch } = useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [share, setShare] = useState<DocsShareInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const toastError = (err: unknown, upgradeHint = false) => {
    const msg = err instanceof Error ? err.message : 'Failed to create share link';
    dispatch({
      type: 'SHOW_TOAST',
      kind: 'error',
      message: upgradeHint && !/upgrade/i.test(msg) ? `${msg} Upgrade to enable public sharing.` : msg,
    });
  };

  const createShare = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await docsApi.share(pageId);
      setShare(res.share);
      setModalOpen(true);
    } catch (err) {
      const isPlanLimit = isApiError(err) && err.status === 403;
      toastError(err, isPlanLimit);
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async () => {
    if (!share) return;
    await copyText(`${window.location.origin}${share.url}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <button
        type="button"
        className="ghost-button"
        data-testid="docs-share"
        disabled={disabled || busy}
        onClick={createShare}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <ShareIcon size={13} />
        Share
      </button>
      {modalOpen && share && (
        <ShareModal
          url={`${window.location.origin}${share.url}`}
          copied={copied}
          onCopy={onCopy}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function ShareModal({
  url,
  copied,
  onCopy,
  onClose,
}: {
  url: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title="Share page" onClose={onClose} testId="docs-share-modal">
      <p className="hint">
        Anyone with this link can view the doc and its images — read-only, no login required.
      </p>
      <div className="share-url-row">
        <input
          className="text-input"
          type="text"
          readOnly
          value={url}
          data-testid="docs-share-url"
          aria-label="Public share URL"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="ghost-button" data-testid="docs-share-copy" onClick={onCopy}>
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className={styles.shareActions}>
        <button type="button" className="primary-button" data-testid="docs-share-done" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
