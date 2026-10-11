'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from './icons';

export function Modal({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Rendered through a portal: several hosts (e.g. the top bar's
  // backdrop-filter) create a containing block that would otherwise trap the
  // `position: fixed` backdrop and push the dialog off-screen. Portalling to
  // <body> keeps every dialog anchored to the viewport.
  if (!mounted) return null;

  return createPortal(
    <div className="modal-backdrop" data-testid={testId ? `${testId}-backdrop` : undefined} onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            data-testid="modal-close"
            onClick={onClose}
          >
            <XIcon size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
