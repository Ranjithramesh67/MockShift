// Shared Playwright helpers for the MockShift tutorial recording.
//
// A visible "cursor" overlay is injected into every page so the recorded video
// feels like a real user session (Playwright does not render the OS cursor).
// Clicks produce a ripple, and `focus()` draws a pulsing ring around the
// element being discussed.

const CURSOR_CSS = `
  html.__tut, html.__tut * { scroll-behavior: auto !important; }
  .__tut_cursor {
    position: fixed; left: 0; top: 0; width: 20px; height: 20px;
    margin: -10px 0 0 -10px; border-radius: 50%;
    background: rgba(255, 255, 255, 0.85);
    border: 2px solid rgba(20, 20, 20, 0.85);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
    pointer-events: none; z-index: 2147483647;
    transition: transform 90ms linear;
  }
  .__tut_ripple {
    position: fixed; width: 12px; height: 12px; margin: -6px 0 0 -6px;
    border-radius: 50%; border: 3px solid rgba(64, 150, 255, 0.9);
    pointer-events: none; z-index: 2147483646;
    animation: __tut_ripple 550ms ease-out forwards;
  }
  @keyframes __tut_ripple {
    0% { transform: scale(0.4); opacity: 1; }
    100% { transform: scale(3.2); opacity: 0; }
  }
  .__tut_focus {
    outline: 3px solid rgba(64, 150, 255, 0.95) !important;
    outline-offset: 3px !important;
    border-radius: 6px;
    animation: __tut_focus 1.1s ease-in-out infinite !important;
  }
  @keyframes __tut_focus {
    0%, 100% { outline-color: rgba(64, 150, 255, 0.95); }
    50% { outline-color: rgba(64, 150, 255, 0.35); }
  }
  .__tut_caption {
    position: fixed; left: 50%; bottom: 42px; transform: translateX(-50%);
    max-width: 78%; padding: 12px 20px; border-radius: 10px;
    background: rgba(8, 12, 10, 0.86); color: #f4f8f5;
    font: 600 22px/1.35 -apple-system, "Segoe UI", Roboto, sans-serif;
    text-align: center; pointer-events: none; z-index: 2147483645;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
  }
`;

export async function installCursor(page) {
  await page.addInitScript((css) => {
    const install = () => {
      if (document.getElementById('__tut_cursor')) return;
      document.documentElement.classList.add('__tut');
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      const dot = document.createElement('div');
      dot.id = '__tut_cursor';
      dot.className = '__tut_cursor';
      dot.style.transform = 'translate(960px, 540px)';
      document.body.appendChild(dot);
      document.addEventListener(
        'mousemove',
        (e) => {
          dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        },
        true
      );
      document.addEventListener(
        'mousedown',
        (e) => {
          const r = document.createElement('div');
          r.className = '__tut_ripple';
          r.style.left = `${e.clientX}px`;
          r.style.top = `${e.clientY}px`;
          document.body.appendChild(r);
          setTimeout(() => r.remove(), 600);
        },
        true
      );
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', install);
    } else {
      install();
    }
  }, CURSOR_CSS);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createHarness(page) {
  const dbg = process.env.TUT_DEBUG
    ? (m) => console.log(`     · ${m}`)
    : () => {};
  const h = {
    page,
    sleep,
    _sceneStart: 0,
    narrationDelayMs: 0,

    // Call after slow setup (e.g. sign-in) so the narration starts once the
    // screen is ready instead of playing over a loading state.
    narrateNow() {
      h.narrationDelayMs = Date.now() - h._sceneStart;
    },

    // Move the (virtual) cursor over a locator without clicking.
    async point(locator, settle = 320) {
      const box = await locator.boundingBox({ timeout: 5000 }).catch(() => null);
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
        await sleep(settle);
      }
    },

    // Pulse a blue focus ring around an element for the duration of a beat.
    async focus(locator, hold = 1400) {
      const count = await locator.count().catch(() => 0);
      if (!count) {
        await sleep(Math.min(hold, 500));
        return;
      }
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await locator.evaluate((el) => el.classList.add('__tut_focus')).catch(() => {});
      await h.point(locator, 260);
      await sleep(hold);
      await locator.evaluate((el) => el.classList.remove('__tut_focus')).catch(() => {});
    },

    async clearFocus() {
      await page
        .evaluate(() => {
          document.querySelectorAll('.__tut_focus').forEach((el) => el.classList.remove('__tut_focus'));
        })
        .catch(() => {});
    },

    // Human-ish click: hover first, then click.
    async tap(locator, settle = 420) {
      const t = Date.now();
      const count = await locator.count().catch(() => 0);
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await h.point(locator, 220);
      await locator.click({ timeout: 6000 }).catch((e) => {
        dbg(`tap failed (${count} matches): ${String(e).split('\n')[0]}`);
      });
      await sleep(settle);
      dbg(`tap ${(Date.now() - t)}ms`);
    },

    async type(locator, text, delay = 26) {
      const t = Date.now();
      await locator.scrollIntoViewIfNeeded().catch(() => {});
      await h.point(locator, 180);
      await locator.click({ timeout: 6000 }).catch(() => {});
      await locator.fill('').catch(() => {});
      await locator.type(text, { delay }).catch(() => {});
      await sleep(220);
      dbg(`type ${(Date.now() - t)}ms`);
    },

    // Show a lower-third caption card (also burned in later via subtitles).
    async caption(text, hold = 2200) {
      await page
        .evaluate((t) => {
          let el = document.getElementById('__tut_caption');
          if (!el) {
            el = document.createElement('div');
            el.id = '__tut_caption';
            el.className = '__tut_caption';
            document.body.appendChild(el);
          }
          el.textContent = t;
        }, text)
        .catch(() => {});
      await sleep(hold);
    },

    async clearCaption() {
      await page
        .evaluate(() => {
          const el = document.getElementById('__tut_caption');
          if (el) el.remove();
        })
        .catch(() => {});
    },

    async goto(path) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await sleep(900);
    },
  };
  return h;
}
