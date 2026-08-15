'use client';

import React from 'react';
import { Modal } from './Modal';
import { FolderIcon } from './icons';
import { useWorkspace } from '@/store/WorkspaceStore';

export type MoveTarget = { collectionId: string } | { collectionId: string; folderId: string };

type FolderOption = { id: string; name: string; depth: number };

function buildFolderOptions(folders: { id: string; collection_id: string; parent_id: string | null; name: string }[], collectionId: string, excludeId?: string): FolderOption[] {
  const byParent = new Map<string | null, { id: string; collection_id: string; parent_id: string | null; name: string }[]>();
  for (const f of folders.filter((x) => x.collection_id === collectionId)) {
    const key = f.parent_id;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(f);
  }
  const result: FolderOption[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of byParent.get(parentId) ?? []) {
      if (excludeId && f.id === excludeId) continue;
      result.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

export function MoveModal({
  title,
  collectionId,
  excludeFolderId,
  onSelect,
  onClose,
}: {
  title: string;
  collectionId: string;
  excludeFolderId?: string;
  onSelect: (target: MoveTarget) => void;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const folders = ws.tree?.folders ?? [];
  const options = buildFolderOptions(folders, collectionId, excludeFolderId);

  return (
    <Modal title={title} onClose={onClose} testId="move-modal">
      <div className="modal-body">
        <p className="hint">Choose a destination folder, or the collection root.</p>
        <div className="move-destination-list" data-testid="move-destinations">
          <button
            type="button"
            className="move-destination"
            data-testid="move-destination-root"
            onClick={() => onSelect({ collectionId })}
          >
            <FolderIcon size={13} />
            Collection root
          </button>
          {options.map((o) => (
            <button
              type="button"
              key={o.id}
              className="move-destination"
              style={{ paddingLeft: `${12 + o.depth * 14}px` }}
              data-testid={`move-destination-${o.name}`}
              onClick={() => onSelect({ collectionId, folderId: o.id })}
            >
              <FolderIcon size={13} />
              {o.name}
            </button>
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
