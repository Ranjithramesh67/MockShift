import { Suspense } from 'react';
import GatewayView from '@/components/GatewayView';

export default function GatewayPage() {
  return (
    <Suspense
      fallback={
        <div className="ck-loading" role="status">
          Loading your payment…
        </div>
      }
    >
      <GatewayView />
    </Suspense>
  );
}
