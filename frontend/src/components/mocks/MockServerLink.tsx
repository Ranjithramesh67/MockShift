'use client';

import React, { useEffect, useState } from 'react';
import { mockBasePath, mockBaseUrl } from '@/lib/mockServer';
import { copyText } from '@/lib/clipboard';
import { useApp } from '@/store/AppStore';
import styles from './mocks.module.css';

export function MockServerLink({ projectId }: { projectId: string }) {
  const { dispatch } = useApp();
  const [origin, setOrigin] = useState('');

  // Read the browser origin after mount so SSR and the first client render agree.
  useEffect(() => setOrigin(window.location.origin), []);

  const display = origin ? mockBaseUrl(projectId, origin) : mockBasePath(projectId);

  const onCopy = async () => {
    const ok = await copyText(mockBaseUrl(projectId, window.location.origin));
    dispatch({
      type: 'SHOW_TOAST',
      kind: ok ? 'success' : 'error',
      message: ok ? 'Mock server link copied.' : 'Could not copy the link.',
    });
  };

  return (
    <span className={styles.linkRow} data-testid="mock-server-link">
      <code className={styles.linkValue} title={display}>
        {display}
      </code>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnGhost}`}
        data-testid="mock-copy-link"
        onClick={onCopy}
      >
        Copy link
      </button>
    </span>
  );
}
