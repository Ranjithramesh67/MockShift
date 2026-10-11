'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { ArrowUpIcon, ArrowDownIcon, GripIcon } from './icons';
import { useNavOrder } from '@/store/NavOrderStore';
import { normalizeRailOrder } from '@/lib/menuKeys';

const RAIL_LABELS: Record<string, string> = {
  apis: 'APIs & collections',
  workflow: 'Workflows',
  teams: 'Teams',
  automations: 'Automations',
  history: 'Run history',
  docs: 'Docs',
  contracts: 'API contracts',
  monitors: 'Monitors',
  'mock-scenarios': 'Mock scenarios',
  copilot: 'AI copilot',
  collab: 'Collaboration',
  'json-compare': 'JSON compare',
  network: 'People',
  manage: 'Manage',
  admin: 'Admin',
};

/**
 * "Customize menu" dialog: reorder the sidebar rail with drag-and-drop or the
 * up/down buttons. Saving persists the order to the server so it applies on
 * every device the user signs in on.
 */
export function NavOrderDialog({
  availableKeys,
  onClose,
}: {
  availableKeys: string[];
  onClose: () => void;
}) {
  const navOrder = useNavOrder();
  const initial = useMemo(
    () => normalizeRailOrder(navOrder.order, availableKeys),
    [navOrder.order, availableKeys]
  );
  const [draft, setDraft] = useState<string[]>(initial);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Re-seed when the dialog opens against a changed order.
  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= draft.length) return;
    setDraft((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await navOrder.save(draft);
    } finally {
      setSaving(false);
      onClose();
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      await navOrder.reset();
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <Modal title="Customize menu" onClose={onClose} testId="nav-order-dialog">
      <p className="nav-order-hint">
        Drag to reorder — or use the arrows. Your order is saved to your account and appears on
        every device you sign in to.
      </p>
      <ul className="nav-order-list" data-testid="nav-order-list">
        {draft.map((key, index) => (
          <li
            key={key}
            className={`nav-order-row ${dragIndex === index ? 'is-dragging' : ''}`}
            data-testid={`nav-order-row-${key}`}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragIndex === null || dragIndex === index) return;
              move(dragIndex, index);
              setDragIndex(index);
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            <span className="nav-order-grip" aria-hidden="true">
              <GripIcon size={15} />
            </span>
            <span className="nav-order-label">{RAIL_LABELS[key] || key}</span>
            <span className="nav-order-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={`Move ${RAIL_LABELS[key] || key} up`}
                data-testid={`nav-order-up-${key}`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUpIcon size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Move ${RAIL_LABELS[key] || key} down`}
                data-testid={`nav-order-down-${key}`}
                disabled={index === draft.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDownIcon size={14} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="modal-actions nav-order-actions-footer">
        <button
          type="button"
          className="ghost-button"
          onClick={reset}
          disabled={saving}
          data-testid="nav-order-reset"
        >
          Reset to default
        </button>
        <div className="nav-order-actions-right">
          <button type="button" className="ghost-button" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={save}
            disabled={saving}
            data-testid="nav-order-save"
          >
            {saving ? 'Saving…' : 'Save order'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
