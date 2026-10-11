// Record the tutorial with Playwright. Each segment gets its own browser
// context (and therefore its own video file) and a timings.json entry mapping
// every scene to its wall-clock start offset, so the narration can be placed
// precisely during assembly.

import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { segments } from './script.mjs';
import { createHarness, installCursor } from './lib/harness.mjs';

const require = createRequire(import.meta.url);
const PLAYWRIGHT_PATH =
  process.env.PLAYWRIGHT_PATH || '/workspace/frontend/node_modules/playwright';
const { chromium } = require(PLAYWRIGHT_PATH);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(__dirname, '.work');
const VIDEO_DIR = path.join(WORK, 'video');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const ONLY = process.env.SEGMENT || '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// In `next dev` the first request to a route compiles it, which can stall the
// recording for seconds. Touch every route once up front (ignoring auth
// redirects) so the pages the tour visits are already compiled.
async function warmRoutes(browser) {
  const routes = [
    '/login', '/', '/manage', '/admin', '/automations', '/history',
    '/docs', '/contracts', '/monitors', '/mock-scenarios', '/copilot',
    '/collab', '/inbox', '/settings/api-tokens',
  ];
  const ctx = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(250);
  }
  await ctx.close();
}

async function main() {
  const narration = JSON.parse(await readFile(path.join(WORK, 'narration.json'), 'utf8'));
  await mkdir(VIDEO_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--hide-scrollbars', '--force-color-profile=srgb'],
  });

  await warmRoutes(browser);

  let report = { baseUrl: BASE_URL, segments: [] };
  if (ONLY) {
    try {
      const previous = JSON.parse(await readFile(path.join(WORK, 'timings.json'), 'utf8'));
      report = previous;
    } catch {
      /* first run */
    }
  }

  for (const segment of segments) {
    if (ONLY && segment.id !== ONLY) continue;
    console.log(`\n=== Segment: ${segment.title} (${segment.id}) ===`);
    const dir = path.join(VIDEO_DIR, segment.id);
    await mkdir(dir, { recursive: true });

    const context = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1600, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      recordVideo: { dir, size: { width: 1600, height: 900 } },
    });
    context.setDefaultTimeout(8000);
    context.setDefaultNavigationTimeout(45000);

    const segStart = Date.now();
    const page = await context.newPage();
    await installCursor(page);
    const h = createHarness(page);

    const scenes = [];
    for (const scene of segment.scenes) {
      const key = `${segment.id}/${scene.id}`;
      const meta = narration[key];
      if (!meta) throw new Error(`No narration for ${key}`);
      const startMs = Date.now() - segStart;
      console.log(`  scene ${scene.id} (${meta.duration.toFixed(2)}s narration)`);
      h._sceneStart = Date.now();
      h.narrationDelayMs = 0;
      await scene.run(page, h);
      await h.clearFocus();
      await h.clearCaption();
      const narrationDelayMs = h.narrationDelayMs;
      const elapsed = Date.now() - segStart - startMs;
      const target = Math.max(narrationDelayMs + meta.duration * 1000 + 180, elapsed + 300);
      if (target - elapsed > 0) await sleep(target - elapsed);
      scenes.push({
        id: scene.id,
        startMs,
        endMs: Date.now() - segStart,
        narrationStartMs: startMs + narrationDelayMs,
        narrationDuration: meta.duration,
        text: meta.text,
        wav: meta.wav,
      });
    }

    const rawVideo = page.video();
    await context.close();
    const raw = await rawVideo.path();
    const stable = path.join(VIDEO_DIR, `${segment.id}.webm`);
    await rename(raw, stable).catch(async () => {
      const { copyFile } = await import('node:fs/promises');
      await copyFile(raw, stable);
    });

    const entry = {
      id: segment.id,
      title: segment.title,
      role: segment.role,
      video: stable,
      durationMs: Date.now() - segStart,
      scenes,
    };
    report.segments = report.segments.filter((s) => s.id !== segment.id);
    report.segments.push(entry);
    console.log(`  -> ${stable}`);
  }

  const order = new Map(segments.map((s, i) => [s.id, i]));
  report.segments.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  await browser.close();
  await writeFile(path.join(WORK, 'timings.json'), JSON.stringify(report, null, 2));
  console.log(`\nWrote ${path.join(WORK, 'timings.json')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
