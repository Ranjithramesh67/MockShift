'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startApp, makeClient, signupAndLogin, psql } = require('./support/harness.cjs');

let base;
let closeApp;
let adminClient;
let alice; // company user, first on keerainnovations.com
let bob;   // second company user on the same domain
let carol; // personal
let dave;  // personal invitee

before(async () => {
  const app = await startApp();
  base = app.base;
  closeApp = app.close;

  const admin = await signupAndLogin(base, 'netadmin@test.io', 'netpass123', 'Net Admin');
  adminClient = admin.client;

  const registered = await adminClient.api('POST', '/api/admin/company-domains', {
    companyName: 'Keera Innovations',
    domain: 'keerainnovations.com',
  });
  assert.equal(registered.status, 201);

  alice = await signupAndLogin(base, 'alice@keerainnovations.com', 'netpass123', 'Alice');
  bob = await signupAndLogin(base, 'bob@keerainnovations.com', 'netpass123', 'Bob');
  carol = await signupAndLogin(base, 'carol@test.io', 'netpass123', 'Carol');
  dave = await signupAndLogin(base, 'dave@test.io', 'netpass123', 'Dave');
});

after(async () => {
  if (closeApp) await closeApp();
});

test('registered company domain creates a named org and later signups join it', async () => {
  const aliceMe = await alice.client.api('GET', '/api/auth/me');
  const company = aliceMe.json.organizations.find((o) => o.kind === 'COMPANY');
  assert.ok(company, 'alice has a COMPANY org');
  assert.equal(company.name, 'Keera Innovations');
  assert.equal(company.domain, 'keerainnovations.com');
  assert.equal(company.role, 'ADMIN');

  const bobMe = await bob.client.api('GET', '/api/auth/me');
  const bobCompany = bobMe.json.organizations.find((o) => o.kind === 'COMPANY');
  assert.ok(bobCompany, 'bob joined a COMPANY org');
  assert.equal(bobCompany.id, company.id, 'bob shares the same org');
  assert.equal(bobCompany.role, 'EDITOR');
});

test('company directory scopes to org members and is searchable', async () => {
  const dir = await bob.client.api('GET', '/api/network/directory');
  assert.equal(dir.status, 200);
  assert.equal(dir.json.scope, 'company');
  const names = dir.json.people.map((p) => p.email);
  assert.ok(names.includes('alice@keerainnovations.com'));
  assert.ok(!names.includes('bob@keerainnovations.com'), 'self excluded');

  const search = await bob.client.api('GET', '/api/network/directory/search?q=ali');
  assert.equal(search.status, 200);
  assert.equal(search.json.people.length, 1);
  assert.equal(search.json.people[0].email, 'alice@keerainnovations.com');

  const empty = await bob.client.api('GET', '/api/network/directory/search?q=a');
  assert.equal(empty.json.people.length, 0, 'query shorter than 2 chars returns nothing');
});

test('organization teammates are exempt from invitations', async () => {
  const same = await alice.client.api('POST', '/api/network/invitations', {
    email: 'bob@keerainnovations.com',
  });
  assert.equal(same.status, 409);
  assert.equal(same.json.code, 'same_organization');
});

test('personal invite -> accept creates a symmetric contact', async () => {
  const self = await carol.client.api('POST', '/api/network/invitations', { email: 'carol@test.io' });
  assert.equal(self.status, 400);

  const invited = await carol.client.api('POST', '/api/network/invitations', {
    email: 'dave@test.io',
    message: 'Let us pair on the API work',
  });
  assert.equal(invited.status, 201);
  assert.equal(invited.json.invitation.status, 'PENDING');

  const incoming = await dave.client.api('GET', '/api/network/invitations?box=incoming');
  assert.equal(incoming.status, 200);
  assert.equal(incoming.json.invitations.length, 1);
  assert.equal(incoming.json.invitations[0].inviter.email, 'carol@test.io');
  const inviteId = incoming.json.invitations[0].id;

  const accepted = await dave.client.api('POST', `/api/network/invitations/${inviteId}/accept`);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.status, 'ACCEPTED');

  const daveContacts = await dave.client.api('GET', '/api/network/contacts');
  assert.equal(daveContacts.json.contacts.length, 1);
  assert.equal(daveContacts.json.contacts[0].email, 'carol@test.io');

  const carolContacts = await carol.client.api('GET', '/api/network/contacts');
  assert.equal(carolContacts.json.contacts.length, 1);
  assert.equal(carolContacts.json.contacts[0].email, 'dave@test.io');

  const personalDir = await carol.client.api('GET', '/api/network/directory');
  assert.equal(personalDir.json.scope, 'personal');
  assert.ok(personalDir.json.people.some((p) => p.email === 'dave@test.io'));

  const globalSearch = await carol.client.api('GET', '/api/network/directory/search?q=dave');
  assert.equal(globalSearch.json.scope, 'personal');
  assert.ok(globalSearch.json.people.some((p) => p.email === 'dave@test.io' && p.is_contact === true));

  const again = await carol.client.api('POST', '/api/network/invitations', { email: 'dave@test.io' });
  assert.equal(again.status, 409);
  assert.equal(again.json.code, 'already_contacts');

  const removed = await carol.client.api('DELETE', `/api/network/contacts/${dave.id}`);
  assert.equal(removed.status, 204);
  const afterRemoval = await dave.client.api('GET', '/api/network/contacts');
  assert.equal(afterRemoval.json.contacts.length, 0, 'removal is symmetric');
});

test('pending invite can be cancelled by the sender', async () => {
  const created = await carol.client.api('POST', '/api/network/invitations', {
    email: 'dave@test.io',
  });
  assert.equal(created.status, 201);
  const id = created.json.invitation.id;

  const cancelled = await carol.client.api('DELETE', `/api/network/invitations/${id}`);
  assert.equal(cancelled.status, 204);
  const incoming = await dave.client.api('GET', '/api/network/invitations?box=incoming');
  assert.equal(incoming.json.invitations.length, 0);

  const strangerCancel = await dave.client.api('DELETE', `/api/network/invitations/${id}`);
  assert.equal(strangerCancel.status, 404);
});

test('login syncs membership for a domain registered after the account existed', async () => {
  const eve = await signupAndLogin(base, 'eve@latejoin.com', 'netpass123', 'Eve');
  const before = await eve.client.api('GET', '/api/network/directory');
  assert.equal(before.json.scope, 'company');

  psql(
    "DELETE FROM organization_members WHERE user_id = (SELECT id FROM users WHERE email = 'eve@latejoin.com');"
  );

  const reg = await adminClient.api('POST', '/api/admin/company-domains', {
    companyName: 'Latejoin Inc',
    domain: 'latejoin.com',
  });
  assert.equal(reg.status, 201);
  assert.ok(reg.json.domain.organization_id, 'registry linked to the existing org');

  // Logging back in re-adds eve even though membership had been removed.
  const relogin = await eve.client.api('POST', '/api/auth/login', {
    email: 'eve@latejoin.com',
    password: 'netpass123',
  });
  assert.equal(relogin.status, 200);
  const dir = await eve.client.api('GET', '/api/network/directory');
  assert.equal(dir.json.scope, 'company');
  assert.equal(dir.json.organization.name, 'Latejoin Inc');

  const frank = await signupAndLogin(base, 'frank@latejoin.com', 'netpass123', 'Frank');
  const withFrank = await eve.client.api('GET', '/api/network/directory');
  assert.ok(withFrank.json.people.some((p) => p.email === 'frank@latejoin.com'));
  const frankMe = await frank.client.api('GET', '/api/auth/me');
  assert.equal(frankMe.json.organizations.find((o) => o.kind === 'COMPANY').role, 'EDITOR');
});

test('company domain registry rejects reserved domains and non-admins', async () => {
  const reserved = await adminClient.api('POST', '/api/admin/company-domains', {
    companyName: 'Testing',
    domain: 'test.io',
  });
  assert.equal(reserved.status, 400);

  const missing = await adminClient.api('POST', '/api/admin/company-domains', {
    companyName: 'No Domain',
  });
  assert.equal(missing.status, 400);

  const forbidden = await carol.client.api('POST', '/api/admin/company-domains', {
    companyName: 'Sneaky Corp',
    domain: 'sneaky.com',
  });
  assert.equal(forbidden.status, 403);

  const listed = await adminClient.api('GET', '/api/admin/company-domains');
  assert.equal(listed.status, 200);
  assert.ok(listed.json.domains.length >= 2);
});
