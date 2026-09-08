'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useNav } from '@/store/NavStore';
import { useWorkspace } from '@/store/WorkspaceStore';
import { isApiMention, type DocsApiRef, type DocsMention } from '@/lib/docsApi';
import { DocsHome } from '../docs/DocsHome';
import { DocsPageView } from '../docs/DocsPageView';

// Coordinator seam: the app shell mounts this view when the nav view becomes
// 'docs'. DocsView is self-contained — it owns its two screens (the home
// list/requests board and the page editor/viewer) and never touches the frozen
// NavStore union beyond switching into 'workspace' when a reader opens a
// mention it can access.
//
// The currently-open page is mirrored into the URL (/docs?p=<pageId>) so the
// open doc survives browser refresh/Back: opening a linked API keeps the doc at
// /docs?p=… in history, so pressing Back after closing the request returns to
// the doc, not the docs list.
export default function DocsView() {
  const nav = useNav();
  const router = useRouter();
  const ws = useWorkspace();
  const searchParams = useSearchParams();
  const [pageId, setPageId] = useState<string | null>(() => {
    const p = searchParams.get('p');
    return p && p.trim() ? p.trim() : null;
  });

  // Single source of truth is the ?p= param: present → open that page,
  // absent → home list. This also drives browser Back between list and page.
  useEffect(() => {
    const p = searchParams.get('p');
    setPageId(p && p.trim() ? p.trim() : null);
  }, [searchParams]);

  const openPage = useCallback(
    (id: string) => {
      router.push(`/docs?p=${encodeURIComponent(id)}`);
    },
    [router]
  );

  const closePage = useCallback(() => {
    router.replace('/docs');
  }, [router]);

  // Deep-link into the workspace: activate the mention's workspace, then open
  // its request. Only invoked for mentions the reader can access (read === true);
  // locked chips never call this (they request access in place instead).
  const openMention = useCallback(
    async (mention: DocsMention) => {
      if (!isApiMention(mention)) return;
      const ref = mention.ref as DocsApiRef;
      // Move to the '/' workspace URL so the deep link is refresh-stable (the
      // route sync maps '/' -> 'workspace').
      router.push('/');
      nav.setView('workspace');
      try {
        await ws.selectWorkspace(ref.workspaceId);
      } catch {
        // Workspace failed to load — fall through and try to open the request
        // anyway so the error surface is the request itself.
      }
      try {
        await ws.selectRequest(ref.id);
      } catch {
        // The request may have been deleted since the page was authored. The
        // workspace is already active; nothing else to do here.
      }
    },
    [nav, router, ws]
  );

  return (
    <main className="admin-main" data-testid="docs-view">
      {pageId ? (
        <DocsPageView pageId={pageId} onBack={closePage} onOpenApi={openMention} />
      ) : (
        <DocsHome onOpenPage={openPage} />
      )}
    </main>
  );
}
