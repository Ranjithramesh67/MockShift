'use strict';

function payPathFromLoginError(err) {
  if (!err || typeof err !== 'object') return null;
  if (err.status !== 402) return null;
  const body = err.body && typeof err.body === 'object' ? err.body : {};
  const portalPath = body.portal_path;
  if (typeof portalPath === 'string' && portalPath.startsWith('/') && !portalPath.startsWith('//')) {
    return portalPath;
  }
  if (typeof body.order_id === 'string' && body.order_id) {
    return `/pay?orderId=${encodeURIComponent(body.order_id)}`;
  }
  return '/#pricing';
}

module.exports = { payPathFromLoginError };
