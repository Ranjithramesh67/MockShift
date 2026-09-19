'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, signupAndLogin, psql } = require('./support/harness.cjs');

let base;
let closeApp;
let owner;    // non-admin, creates the team, personal org
let friend;   // accepted contact (also the platform admin) from another org
let stranger; // never connected

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;

  // The very first account became the platform admin; the team owner is a
  // regular user so the org/contact-scoped listing is exercised.
  friend = await signupAndLogin(base, 'friend@test.io', 'teampass123', 'Friend');
  owner = await signupAndLogin(base, 'owner@test.io', 'teampass123', 'Owner');
  stranger = await signupAndLogin(base, 'stranger@test.io', 'teampass123', 'Stranger');

  await acceptContact(owner, friend);
});

after(async () => {
  if (closeApp) await closeApp();
});

async function makeTeam() {
  const res = await owner.client.api('POST', '/api/teams', { name: 'Shared Team' });
  assert.equal(res.status, 201);
  return res.json.team.id;
}

async function acceptContact(inviter, invitee) {
  const invited = await inviter.client.api('POST', '/api/network/invitations', {
    email: invitee.user.email,
  });
  assert.equal(invited.status, 201);
  const inbox = await invitee.client.api('GET', '/api/network/invitations?box=incoming');
  const inviteId = inbox.json.invitations[0].id;
  const accepted = await invitee.client.api('POST', `/api/network/invitations/${inviteId}/accept`);
  assert.equal(accepted.status, 200);
}

test('accepted contact outside the org becomes selectable for a team', async () => {
  const teamId = await makeTeam();

  const listing = await owner.client.api('GET', `/api/teams/${teamId}/org-users`);
  assert.equal(listing.status, 200);
  const ids = listing.json.users.map((u) => u.id);
  assert.ok(ids.includes(friend.id), 'accepted contact is listed');
  assert.ok(!ids.includes(stranger.id), 'a stranger is not listed');
  assert.ok(!ids.includes(owner.id), 'the requester is already a member');
});

test('team admin can seat an accepted contact on the team', async () => {
  const teamId = await makeTeam();

  const added = await owner.client.api('POST', `/api/teams/${teamId}/members`, {
    userId: friend.id,
    role: 'EDITOR',
  });
  assert.equal(added.status, 201);
  assert.ok(added.json.members.some((m) => m.id === friend.id && m.role === 'EDITOR'));
});

test('non-admins cannot list or add team members', async () => {
  const teamId = await makeTeam();
  await owner.client.api('POST', `/api/teams/${teamId}/members`, { userId: friend.id, role: 'EDITOR' });

  const list = await stranger.client.api('GET', `/api/teams/${teamId}/org-users`);
  assert.equal(list.status, 403);

  const add = await stranger.client.api('POST', `/api/teams/${teamId}/members`, {
    userId: owner.id,
    role: 'EDITOR',
  });
  assert.equal(add.status, 403);
});

test('seating a new person is blocked when the org plan has no spare seat', async () => {
  const teamId = await makeTeam();
  psql('UPDATE portal_settings SET restrictions_enforced = true;');
  try {
    const blocked = await owner.client.api('POST', `/api/teams/${teamId}/members`, {
      userId: stranger.id,
      role: 'EDITOR',
    });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.json.code, 'plan_limit');
    assert.equal(blocked.json.key, 'seats');
    assert.equal(blocked.json.upgrade, true);
  } finally {
    psql('UPDATE portal_settings SET restrictions_enforced = false;');
  }

  const allowed = await owner.client.api('POST', `/api/teams/${teamId}/members`, {
    userId: stranger.id,
    role: 'EDITOR',
  });
  assert.equal(allowed.status, 201);
});
