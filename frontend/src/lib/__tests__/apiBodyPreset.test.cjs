'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  API_BODY_PRESETS,
  bodyPresetForApiType,
  isBodyMethod,
  isPresetBodyText,
  resolveApiTypeSwitch,
} = require('../apiBodyPreset');

test('each API type has a body preset matching its content shape', () => {
  assert.equal(bodyPresetForApiType('REST').bodySel, 'JSON');
  assert.equal(bodyPresetForApiType('SOAP').bodySel, 'XML');
  assert.equal(bodyPresetForApiType('GRAPHQL').bodySel, 'JSON');
  assert.equal(bodyPresetForApiType('AUTH').bodySel, 'JSON');
  assert.equal(bodyPresetForApiType('NOPE'), null);

  // REST/GraphQL/Auth bodies parse as JSON; SOAP is an XML envelope.
  JSON.parse(API_BODY_PRESETS.REST.bodyText);
  JSON.parse(API_BODY_PRESETS.GRAPHQL.bodyText);
  JSON.parse(API_BODY_PRESETS.AUTH.bodyText);
  assert.match(API_BODY_PRESETS.SOAP.bodyText, /^<\?xml .*<soap:Envelope/s);
});

test('SOAP preset is XML and GraphQL preset carries a ping query', () => {
  assert.match(bodyPresetForApiType('SOAP').bodyText, /<soap:Envelope/);
  assert.equal(JSON.parse(bodyPresetForApiType('GRAPHQL').bodyText).query, 'query { ping }');
});

test('isPresetBodyText treats empty and untouched seeds as pristine', () => {
  assert.equal(isPresetBodyText(''), true);
  assert.equal(isPresetBodyText(null), true);
  assert.equal(isPresetBodyText(undefined), true);
  assert.equal(isPresetBodyText('   '), true);
  assert.equal(isPresetBodyText(API_BODY_PRESETS.SOAP.bodyText), true);
  // Whitespace differences around a seed still count as untouched.
  assert.equal(isPresetBodyText(`\n${API_BODY_PRESETS.REST.bodyText}\n`), true);
});

test('isPresetBodyText leaves user-authored content alone', () => {
  assert.equal(isPresetBodyText('{"customer":"A1"}'), false);
  assert.equal(isPresetBodyText('<Request><a>1</a></Request>'), false);
});

test('resolveApiTypeSwitch swaps JSON for XML and back', () => {
  // GET + REST → SOAP forces POST and seeds the XML envelope.
  const toSoap = resolveApiTypeSwitch({ apiType: 'SOAP' }, { method: 'GET', bodyText: '' });
  assert.equal(toSoap.method, 'POST');
  assert.equal(toSoap.bodySel, 'XML');
  assert.equal(toSoap.bodyChanged, true);
  assert.match(toSoap.bodyText, /<soap:Envelope/);
  assert.equal(toSoap.bodyTabAvailable, true);

  // SOAP → REST returns to JSON, replacing the untouched XML seed.
  const toRest = resolveApiTypeSwitch(
    { apiType: 'REST' },
    { method: 'POST', bodyText: API_BODY_PRESETS.SOAP.bodyText }
  );
  assert.equal(toRest.method, 'POST');
  assert.equal(toRest.bodySel, 'JSON');
  assert.equal(toRest.bodyChanged, true);
  assert.match(toRest.bodyText, /"key": "value"/);

  // GraphQL seeds a query JSON body.
  const toGraphql = resolveApiTypeSwitch({ apiType: 'GRAPHQL' }, { method: 'GET', bodyText: '' });
  assert.equal(toGraphql.bodySel, 'JSON');
  assert.equal(JSON.parse(toGraphql.bodyText).query, 'query { ping }');
});

test('resolveApiTypeSwitch keeps a hand-edited body but still adapts the kind', () => {
  const result = resolveApiTypeSwitch(
    { apiType: 'SOAP' },
    { method: 'POST', bodyText: '{"customer":"A1"}' }
  );
  assert.equal(result.bodyChanged, false);
  assert.equal(result.bodyText, '{"customer":"A1"}');
  assert.equal(result.bodySel, 'XML');
});

test('isBodyMethod matches the methods that carry a body', () => {
  assert.deepEqual(
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY'].filter(isBodyMethod),
    ['POST', 'PUT', 'PATCH', 'QUERY']
  );
});
