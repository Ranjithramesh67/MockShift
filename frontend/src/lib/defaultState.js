'use strict';

const { parseCurl } = require('./curl');

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function requestFromCurl(name, curlInput) {
  const parsed = parseCurl(curlInput);
  return {
    id: makeId('req'),
    name: name || parsed.name || 'Imported request',
    method: parsed.method,
    url: parsed.url,
    headers: parsed.headers,
    queryParams: parsed.queryParams,
    bodyType: parsed.bodyType,
    bodyJson: parsed.bodyJson || parsed.bodyText || null,
    bodyText: parsed.bodyText || null,
    contentType: parsed.contentType,
    formula: '', apiType: 'REST', assertions: [],
  };
}

const defaultRequests = [
  {
    id: 'req_login',
    name: 'Login',
    method: 'POST',
    url: 'https://api.example.com/auth/login',
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    queryParams: [],
    bodyType: 'JSON',
    bodyJson: JSON.stringify({ email: 'user@example.com', password: 's3cret' }, null, 2),
    bodyText: null,
    contentType: 'application/json',
    formula: '', apiType: 'REST', assertions: [],
  },
  {
    id: 'req_create_order',
    name: 'Create Order',
    method: 'POST',
    url: 'https://api.example.com/orders',
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    queryParams: [],
    bodyType: 'JSON',
    bodyJson: JSON.stringify({ customer: '{{customerId}}', items: [{ sku: 'A1', qty: 2 }] }, null, 2),
    bodyText: null,
    contentType: 'application/json',
    formula: '', apiType: 'REST', assertions: [],
  },
  {
    id: 'req_get_order',
    name: 'Get Order',
    method: 'GET',
    url: 'https://api.example.com/orders/{{order.id}}',
    headers: [],
    queryParams: [{ key: 'include', value: 'line_items', enabled: true }],
    bodyType: 'NONE',
    bodyJson: null,
    bodyText: null,
    contentType: 'text/plain',
    formula: '', apiType: 'REST', assertions: [],
  },
  {
    id: 'req_charge',
    name: 'Charge Payment',
    method: 'POST',
    url: 'https://api.example.com/payments',
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    queryParams: [],
    bodyType: 'JSON',
    bodyJson: JSON.stringify({ orderId: '{{order.id}}', amount: 4999 }, null, 2),
    bodyText: null,
    contentType: 'application/json',
    formula: 'req.body.amount = $utils.round(req.body.amount * 1.0, 2);',
  },
];

const defaultWorkflows = [
  {
    id: 'wf_order_flow',
    name: 'Order fulfilment',
    steps: [
      {
        id: 'create_order',
        label: 'Create the order',
        requestId: 'req_create_order',
        delayMs: 0,
        loop: { type: 'none' },
        onFailure: 'abort',
        formula: '',
      },
      {
        id: 'charge_payment',
        label: 'Charge the card',
        requestId: 'req_charge',
        delayMs: 500,
        loop: { type: 'count', count: 2 },
        onFailure: 'skip',
        formula: '',
      },
    ],
  },
];

function defaultState() {
  return {
    activeTab: 'request',
    activeRequestId: 'req_login',
    requests: defaultRequests,
    activeWorkflowId: 'wf_order_flow',
    workflows: defaultWorkflows,
    activeRequestTab: 'params',
    viewMode: 'split',
    lastResponse: null,
    toast: null,
  };
}

module.exports = { defaultState, makeId, requestFromCurl };
