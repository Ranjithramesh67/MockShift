import { Suspense } from 'react';
import PayReturnView from '@/components/PayReturnView';

export default function PayReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="ck-loading" role="status">
          Confirming your payment…
        </div>
      }
    >
      <PayReturnView />
    </Suspense>
  );
}
