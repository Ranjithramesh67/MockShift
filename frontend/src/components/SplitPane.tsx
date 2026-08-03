'use client';

import React, { useCallback, useRef, useState } from 'react';

/**
 * A vertical resizable split pane. The `top` region gets `initialRatio` of the
 * height; the divider can be dragged to resize; `bottom` flexes to fill.
 */
export function SplitPane({
  top,
  bottom,
  initialRatio = 0.55,
  minTopRatio = 0.15,
  maxTopRatio = 0.85,
}: {
  top: React.ReactNode;
  bottom: React.ReactNode;
  initialRatio?: number;
  minTopRatio?: number;
  maxTopRatio?: number;
}) {
  const [ratio, setRatio] = useState(initialRatio);
  const containerRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const clamp = (pct: number) => Math.min(maxTopRatio, Math.max(minTopRatio, pct));
      const move = (ev: PointerEvent) => {
        setRatio(clamp((ev.clientY - rect.top) / rect.height));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('is-dragging');
      };
      document.body.classList.add('is-dragging');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      e.preventDefault();
    },
    [maxTopRatio, minTopRatio]
  );

  return (
    <div className="split-pane" ref={containerRef} data-testid="split-pane">
      <div className="split-pane-top" style={{ height: `${ratio * 100}%` }}>
        {top}
      </div>
      <div className="split-pane-divider" onPointerDown={onPointerDown} role="separator" />
      <div className="split-pane-bottom">{bottom}</div>
    </div>
  );
}
