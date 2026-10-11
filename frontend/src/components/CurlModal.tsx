'use client';

import { CreateModal } from './CreateModal';

/**
 * "Import cURL" entry point (top-bar button and the request editor's Import
 * button). Rather than a bespoke import dialog, it opens the exact same model
 * as "New API request" — CreateModal kind=request — pre-set to its cURL tab so
 * the parsed command flows through the standard create-request pipeline.
 */
export function CurlModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <CreateModal kind="request" initialMode="curl" onClose={onClose} />;
}
