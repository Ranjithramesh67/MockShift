import { redirect } from 'next/navigation';

// The simulated gateway page is retired now that payments go through Cashfree;
// keep the route working by forwarding to the real payment page.
export default function GatewayPage({
  searchParams,
}: {
  searchParams: { orderId?: string };
}) {
  const orderId = typeof searchParams.orderId === 'string' ? searchParams.orderId : '';
  redirect(orderId ? `/pay?orderId=${encodeURIComponent(orderId)}` : '/#pricing');
}
