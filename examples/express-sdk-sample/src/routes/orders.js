'use strict';

const { Router } = require('express');

const orders = [
  { id: 'ord_1001', userId: '1', total: 42.5, currency: 'USD' },
  { id: 'ord_1002', userId: '2', total: 17, currency: 'EUR' },
];

const items = Router({ mergeParams: true });

items.get('/', (req, res) => {
  res.json({
    orderId: req.params.orderId,
    items: [
      { sku: 'sku-blue', quantity: 2 },
      { sku: 'sku-green', quantity: 1 },
    ],
  });
});

const router = Router();

router.get('/', (req, res) => {
  const userId = req.query.userId;
  const rows = userId ? orders.filter((o) => o.userId === userId) : orders;
  res.json({ orders: rows });
});

router.get('/:orderId', (req, res) => {
  const order = orders.find((o) => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

router.use('/:orderId/items', items);

module.exports = router;
