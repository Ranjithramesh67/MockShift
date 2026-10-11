'use client';

import { useEffect } from 'react';

// In-page hash links on the marketing site (e.g. "/#pricing", "#faq") point at
// sections of the home page. Next.js scroll restoration can run after the
// browser's own hash jump and leave the viewport at the top, so the URL changes
// but the section never comes into view. Re-scroll a few times after mount and
// on every hashchange so those links always land on their target.
export function HashScroll() {
  useEffect(() => {
    const scrollToHash = () => {
      const hash = window.location.hash;
      if (!hash || hash.length < 2) return;
      let id = hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        /* keep raw id */
      }
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: 'auto', block: 'start' });
    };

    scrollToHash();
    const timers = [window.setTimeout(scrollToHash, 60), window.setTimeout(scrollToHash, 350)];
    window.addEventListener('hashchange', scrollToHash);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('hashchange', scrollToHash);
    };
  }, []);

  return null;
}
