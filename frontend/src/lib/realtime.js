'use strict';

function roomFor(kind, id) {
  if (!kind || !id) return null;
  return `${kind}:${id}`;
}

function eventsUrl(room) {
  return room ? `/api/events?room=${encodeURIComponent(room)}` : '/api/events';
}

function parseSseFrame(frame) {
  const raw = String(frame || '').trim();
  if (!raw) return null;
  // Accept either a raw frame block (`event: message` / `data: {...}`) or a
  // bare payload (EventSource strips the `data:` prefix before onmessage).
  const dataLine = raw.split('\n').find((line) => line.startsWith('data:'));
  const payload = dataLine ? dataLine.slice(5).trim() : raw;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function viewerSummary(viewers, selfId) {
  if (!Array.isArray(viewers)) return { count: 0, label: '' };
  const others = viewers.filter((v) => v && v.id && v.id !== selfId).length;
  if (others === 0) return { count: 0, label: 'You are the only one here' };
  if (others === 1) return { count: 1, label: '1 other viewing' };
  return { count: others, label: `${others} others viewing` };
}

module.exports = { roomFor, eventsUrl, parseSseFrame, viewerSummary };
