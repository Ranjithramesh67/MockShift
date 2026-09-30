'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isLocalHostname, isLocalUrl, maybeLocal } = require('../localHost.js');

test('isLocalHostname recognises loopback hosts', () => {
  for (const host of ['localhost', 'LOCALHOST', 'app.localhost', '127.0.0.1', '127.5.5.5', '0.0.0.0', '::1', '[::1]']) {
    assert.equal(isLocalHostname(host), true, `${host} should be local`);
  }
});

test('isLocalHostname recognises private ranges', () => {
  for (const host of ['10.0.0.5', '10.255.255.255', '192.168.1.1', '172.16.0.1', '172.31.255.255', 'fc00::1', 'fd12:3456::1']) {
    assert.equal(isLocalHostname(host), true, `${host} should be local`);
  }
});

test('isLocalHostname rejects public and adjacent hosts', () => {
  for (const host of ['example.com', '8.8.8.8', '11.0.0.1', '192.169.0.1', '172.15.0.1', '172.32.0.1', 'mockshift.keerainnovations.com', '']) {
    assert.equal(isLocalHostname(host), false, `${host} should not be local`);
  }
});

test('isLocalUrl parses the host out of a url', () => {
  assert.equal(isLocalUrl('http://localhost:8082/emea-router/api/health'), true);
  assert.equal(isLocalUrl('http://127.0.0.1:3001/mock/p1'), true);
  assert.equal(isLocalUrl('https://api.example.com/v1/items'), false);
  assert.equal(isLocalUrl('not a url'), false);
  assert.equal(isLocalUrl(''), false);
});

test('maybeLocal flags raw urls that could resolve to a local host', () => {
  assert.equal(maybeLocal('http://localhost:8082/x'), true);
  assert.equal(maybeLocal('{{BASE_URL}}/x'), true);
  assert.equal(maybeLocal('https://api.example.com/x'), false);
  assert.equal(maybeLocal(''), false);
});
