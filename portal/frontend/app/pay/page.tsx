import { Suspense } from 'react';
import PayView from '@/components/PayView';

export default function PayPage() {
  return (
    <Suspense
      fallback={
        <div className="ck-loading" role="status">
          Preparing your secure payment…
        </div>
      }
    >
      <PayView />
    </Suspense>
  );
}
