import { Suspense } from 'react';
import ReceiptView from '@/components/ReceiptView';
import { apiHubAppUrl } from '@/lib/appUrl';

type Props = {
  params: { orderId: string };
  searchParams?: { bonus?: string | string[] };
};

export default function ReceiptOrderPage({ params, searchParams }: Props) {
  const raw = Array.isArray(searchParams?.bonus) ? searchParams?.bonus[0] : searchParams?.bonus;
  const bonusDays = Math.max(0, Number(raw) || 0);
  const appUrl = apiHubAppUrl();
  return (
    <Suspense
      fallback={
        <div className="ck-loading" role="status">
          Loading your receipt…
        </div>
      }
    >
      <ReceiptView orderId={params.orderId} bonusDays={bonusDays} appUrl={appUrl} />
    </Suspense>
  );
}
