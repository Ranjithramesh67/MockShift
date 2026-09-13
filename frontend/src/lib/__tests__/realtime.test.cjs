'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomFor, eventsUrl, parseSseFrame, viewerSummary } = require('../realtime.js');

test('roomFor builds rooms and rejects missing ids', () => {
  assert.equal(roomFor('request', 'r1'), 'request:r1');
  assert.equal(roomFor('user', 'u1'), 'user:u1');
  assert.equal(roomFor('request', null), null);
  assert.equal(roomFor('request', ''), null);
});

test('eventsUrl encodes the room and omits it when absent', () => {
  assert.equal(eventsUrl('collection:c 1'), '/api/events?room=collection%3Ac%201');
  assert.equal(eventsUrl(null), '/api/events');
});

test('parseSseFrame extracts the JSON data line', () => {
  const frame = 'event: message\ndata: {"type":"presence","viewers":[]}';
  assert.deepEqual(parseSseFrame(frame), { type: 'presence', viewers: [] });
  assert.equal(parseSseFrame('event: ping'), null);
  assert.equal(parseSseFrame('data: not-json'), null);
  // EventSource.onmessage receives the bare payload with the prefix stripped.
  assert.deepEqual(parseSseFrame('{"type":"notification","notification":{"id":"n1"}}'), {
    type: 'notification',
    notification: { id: 'n1' },
  });
  assert.equal(parseSseFrame(''), null);
});

test('viewerSummary excludes self and labels the count', () => {
  const viewers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(viewerSummary(viewers, 'a'), { count: 2, label: '2 others viewing' });
  assert.deepEqual(viewerSummary([{ id: 'a' }], 'a'), { count: 0, label: 'You are the only one here' });
  assert.deepEqual(viewerSummary([{ id: 'a' }, { id: 'b' }], 'a'), { count: 1, label: '1 other viewing' });
  assert.deepEqual(viewerSummary(null, 'a'), { count: 0, label: '' });
});
