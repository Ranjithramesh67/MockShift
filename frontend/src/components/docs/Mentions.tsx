'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '@/store/AppStore';
import { accessRequestApi, type ApiError } from '@/lib/api';
import { docsSharedApi, isApiError, type DocsBlock, type DocsMention } from '@/lib/docsApi';
import { blockMethod, blockNum, blockStrings, blockText } from '@/lib/docsApi';
import { imageSizeOf, IMAGE_SIZE_PCT } from '@/lib/docsApi';
import { formatBody } from './helpers';
import styles from './docs.module.css';
import { LockIcon, XIcon } from '@/components/icons';

const METHOD_COLORS: Record<string, string> = {
  GET: '#1f6feb',
  POST: '#2ea043',
  PUT: '#9e6a03',
  PATCH: '#8957e5',
  DELETE: '#da3633',
  HEAD: '#6b7684',
  OPTIONS: '#6b7684',
};

function methodColor(method: string): string {
  return METHOD_COLORS[method.toUpperCase()] ?? '#6b7684';
}

function ChipDot({ initial }: { initial: string }) {
  return (
    <span className={styles.avatarDot} aria-hidden>
      {initial}
    </span>
  );
}

// ------------------------------------------------------------- block viewer
function Block({ block }: { block: DocsBlock }) {
  const c = block.content;
  switch (block.type) {
    case 'heading': {
      const text = blockText(c, 'text');
      if (!text) return null;
      return <h2 className={styles.rHeading}>{text}</h2>;
    }
    case 'text': {
      const text = blockText(c, 'text');
      if (!text) return null;
      return <p className={styles.rText}>{text}</p>;
    }
    case 'code': {
      const language = blockText(c, 'language', 'text');
      const code = blockText(c, 'code');
      if (!code) return null;
      return (
        <div className={styles.card} data-testid="docs-block-code">
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>Code</span>
            {language && <span className={styles.langChip}>{language}</span>}
          </div>
          <pre className={`${styles.monoArea} ${styles.codePre}`}>{formatBody(code)}</pre>
        </div>
      );
    }
    case 'payload': {
      const method = blockMethod(c);
      const ct = blockText(c, 'contentType', 'application/json');
      const body = blockText(c, 'body');
      return (
        <div className={styles.card} data-testid="docs-block-payload">
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>Payload</span>
            <span className={styles.methodChip} style={{ background: methodColor(method) }}>
              {method}
            </span>
            {ct && <span className={styles.contentTypeChip}>{ct}</span>}
          </div>
          {body && (
            <pre className={`${styles.monoArea} ${styles.codePre}`} data-testid="docs-block-payload-body">
              {formatBody(body)}
            </pre>
          )}
        </div>
      );
    }
    case 'response': {
      const status = blockNum(c, 'status', 0);
      const body = blockText(c, 'body');
      return (
        <div className={styles.card} data-testid="docs-block-response">
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>Response</span>
            <span className={styles.methodChip} style={{ background: status >= 200 && status < 300 ? '#2ea043' : status >= 400 ? '#da3633' : '#6b7684' }}>
              {String(status)}
            </span>
          </div>
          {body && (
            <pre className={`${styles.monoArea} ${styles.codePre}`} data-testid="docs-block-response-body">
              {formatBody(body)}
            </pre>
          )}
        </div>
      );
    }
    case 'schema': {
      const language = blockText(c, 'language', 'json');
      const definition = blockText(c, 'definition');
      if (!definition) return null;
      return (
        <div className={styles.card} data-testid="docs-block-schema">
          <div className={styles.cardHead}>
            <span className={styles.cardTitle}>Schema</span>
            {language && <span className={styles.langChip}>{language}</span>}
          </div>
          <pre className={`${styles.monoArea} ${styles.codePre}`}>{formatBody(definition)}</pre>
        </div>
      );
    }
    case 'list': {
      const style = blockText(c, 'style', 'bullet');
      const items = blockStrings(c, 'items').filter((s) => s.trim().length > 0);
      if (items.length === 0) return null;
      return style === 'number' ? (
        <ol className={`${styles.rList} ${styles.rListNumber}`} data-testid="docs-block-list">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      ) : (
        <ul className={`${styles.rList} ${styles.rListBullet}`} data-testid="docs-block-list">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    }
    case 'image': {
      const src = blockText(c, 'src');
      const alt = blockText(c, 'alt');
      const caption = blockText(c, 'caption');
      const size = imageSizeOf(c);
      if (!src) return null;
      return (
        <figure className={styles.imgBlock} data-testid="docs-block-image">
          <img
            className={styles.imgEl}
            src={src}
            alt={alt}
            data-size={size}
            style={{ maxWidth: `${IMAGE_SIZE_PCT[size]}%` }}
          />
          {caption && <figcaption className={styles.imgCaption}>{caption}</figcaption>}
        </figure>
      );
    }
  }
}

export function BlockView({ blocks }: { blocks: DocsBlock[] }) {
  return (
    <div className={styles.viewerBlocks} data-testid="docs-blocks">
      {blocks.length === 0 && <p className={styles.editorHint}>This page has no content yet.</p>}
      {blocks.map((b, i) => (
        <div key={b.id ?? `new-${i}`}>
          <Block block={b} />
          <div className={styles.blockGap} />
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ mentions
// API mention chip: deep-links into the workspace when the reader has access;
// otherwise offers an inline project access-request (VIEWER).
export function ApiMentionChip({
  mention,
  onOpenApi,
}: {
  mention: DocsMention & { ref: { access: { read: boolean } } };
  onOpenApi: (mention: DocsMention) => void;
}) {
  const { dispatch } = useApp();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const ref = mention.ref as { id: string; name: string; method: string; workspaceId: string; projectId: string; access: { read: boolean } };

  useEffect(() => {
    if (ref.access.read) return;
    docsSharedApi
      .projectAccessRequests(ref.projectId)
      .then((res) => {
        if (res.accessRequests.some((r) => r.status === 'PENDING')) setPending(true);
      })
      .catch(() => undefined);
  }, [ref.projectId, ref.access.read]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const requestAccess = async () => {
    setBusy(true);
    try {
      await accessRequestApi.request(
        ref.projectId,
        'Requested from docs — need access to this API',
        'VIEWER'
      );
      setPending(true);
    } catch (err) {
      if (isApiError(err) && (err as ApiError).status === 409) {
        setPending(true);
      } else {
        dispatch({
          type: 'SHOW_TOAST',
          kind: 'error',
          message: err instanceof Error ? err.message : 'Failed to request access',
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const openApi = () => {
    setOpen(false);
    onOpenApi(mention);
  };

  return (
    <span className={styles.chipWrap} ref={boxRef} data-testid={`docs-api-chip-${mention.id}`}>
      <button
        type="button"
        className={`${styles.chip} ${styles.chipApi} ${ref.access.read ? '' : styles.locked}`}
        onClick={() => (ref.access.read ? openApi() : setOpen((v) => !v))}
        title={ref.access.read ? `Open ${ref.name}` : 'No access to this API'}
      >
        <span className={styles.methodDot} style={{ color: methodColor(ref.method) }}>
          {ref.method.toUpperCase()}
        </span>
        {ref.name}
        {!ref.access.read && <LockIcon size={12} />}
      </button>
      {open && !ref.access.read && (
        <div className={styles.accessBox} data-testid="docs-access-box">
          <div className={styles.accessTitle}>Request access</div>
          <p className={styles.accessDesc}>
            You can read this page but you don&apos;t have access to <strong>{ref.name}</strong>. Request
            read access to open it in the workspace.
          </p>
          {pending ? (
            <span className={styles.accessPending} data-testid="docs-access-pending">
              Access requested — pending approval
            </span>
          ) : (
            <button type="button" className="primary-button" data-testid="docs-request-access" disabled={busy} onClick={requestAccess}>
              {busy ? 'Requesting…' : 'Request access'}
            </button>
          )}
        </div>
      )}
    </span>
  );
}

// User mention chip: @Name with a subtle popover showing the email.
export function UserMentionChip({ mention }: { mention: DocsMention }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const ref = mention.ref as { id: string; name: string; email?: string | null };

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <span className={styles.chipWrap} ref={wrapRef} data-testid={`docs-user-chip-${mention.id}`}>
      <button type="button" className={`${styles.chip} ${styles.chipUser}`} onClick={() => setOpen((v) => !v)}>
        <ChipDot initial={ref.name.charAt(0).toUpperCase() ?? '?'} />
        <span className={styles.at}>@</span>
        {ref.name}
      </button>
      {open && (
        <div className={styles.popCard} data-testid="docs-user-popover">
          <div className={styles.popName}>{ref.name}</div>
          <div className={styles.popEmail}>{ref.email || 'No email on file'}</div>
        </div>
      )}
    </span>
  );
}

export function MentionChips({
  mentions,
  mode,
  onOpenApi,
  onRemove,
}: {
  mentions: DocsMention[];
  mode: 'view' | 'edit';
  onOpenApi?: (mention: DocsMention) => void;
  onRemove?: (mentionId: string) => void;
}) {
  if (mentions.length === 0) return null;
  return (
    <div className={styles.chipRow} data-testid="docs-mentions">
      {mentions.map((m) => {
        if (m.type === 'api') {
          const ref = m.ref as { access: { read: boolean } };
          if (mode === 'edit') {
            return (
              <span key={m.id} className={`${styles.chip} ${styles.chipApi}`} data-testid={`docs-mention-chip-${m.id}`}>
                <span className={styles.methodDot} style={{ color: methodColor((m.ref as { method: string }).method) }}>
                  {(m.ref as { method: string }).method.toUpperCase()}
                </span>
                {(m.ref as { name: string }).name}
                {onRemove && (
                  <button type="button" className={styles.chipX} aria-label="Remove mention" onClick={() => onRemove(m.id)}>
                    <XIcon size={12} />
                  </button>
                )}
              </span>
            );
          }
          return <ApiMentionChip key={m.id} mention={m as DocsMention & { ref: { access: { read: boolean } } }} onOpenApi={onOpenApi ?? (() => undefined)} />;
        }
        if (mode === 'edit') {
          return (
            <span key={m.id} className={`${styles.chip} ${styles.chipUser}`} data-testid={`docs-mention-chip-${m.id}`}>
              <span className={styles.at}>@</span>
              {(m.ref as { name: string }).name}
              {onRemove && (
                <button type="button" className={styles.chipX} aria-label="Remove mention" onClick={() => onRemove(m.id)}>
                  <XIcon size={12} />
                </button>
              )}
            </span>
          );
        }
        return <UserMentionChip key={m.id} mention={m} />;
      })}
    </div>
  );
}
