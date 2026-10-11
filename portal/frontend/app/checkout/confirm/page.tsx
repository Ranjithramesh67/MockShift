import { Suspense } from 'react';
import CheckoutConfirmView from '@/components/CheckoutConfirmView';

export default function CheckoutConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="ck-loading" role="status">
          Loading your order…
        </div>
      }
    >
      <CheckoutConfirmView />
    </Suspense>
  );
}
