import { Suspense } from 'react';
import CheckoutView from '@/components/CheckoutView';

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="ck-loading" role="status">
          Loading checkout…
        </div>
      }
    >
      <CheckoutView />
    </Suspense>
  );
}
