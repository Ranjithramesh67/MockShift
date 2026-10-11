'use client';

import React, { useCallback, useRef, useState } from 'react';

/**
 * A resizable two-pane split. `orientation="vertical"` stacks the panes
 * top/bottom (the first pane gets `initialRatio` of the height, the divider
 * can be dragged to resize). `orientation="horizontal"` places them side by
 * side (first pane = left, second pane = right).
 */
export function SplitPane({
  top,
  bottom,
  orientation = 'vertical',
  initialRatio = 0.55,
  minRatio = 0.15,
  maxRatio = 0.85,
}: {
  top: React.ReactNode;
  bottom: React.ReactNode;
  orientation?: 'vertical' | 'horizontal';
  initialRatio?: number;
  minRatio?: number;
  maxRatio?: number;
}) {
  const [ratio, setRatio] = useState(initialRatio);
  const containerRef = useRef<HTMLDivElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const clamp = (pct: number) => Math.min(maxRatio, Math.max(minRatio, pct));
      const axis = orientation === 'vertical' ? rect.height : rect.width;
      const start = orientation === 'vertical' ? rect.top : rect.left;
      const move = (ev: PointerEvent) => {
        setRatio(clamp((ev.clientY - start) / axis));
      };
      const moveX = (ev: PointerEvent) => {
        setRatio(clamp((ev.clientX - start) / axis));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointermove', moveX);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('is-dragging');
      };
      document.body.classList.add('is-dragging');
      window.addEventListener('pointermove', orientation === 'vertical' ? move : moveX);
      window.addEventListener('pointerup', up);
      e.preventDefault();
    },
    [maxRatio, minRatio, orientation]
  );

  const orientationClass = orientation === 'vertical' ? 'split-pane-vertical' : 'split-pane-horizontal';

  return (
    <div
      className={`split-pane ${orientationClass}`}
      ref={containerRef}
      data-testid={`split-pane-${orientation}`}
    >
      <div className="split-pane-first" style={{ [orientation === 'vertical' ? 'height' : 'width']: `${ratio * 100}%` }}>
        {top}
      </div>
      <div className="split-pane-divider" onPointerDown={onPointerDown} role="separator" />
      <div className="split-pane-second">{bottom}</div>
    </div>
  );
}
