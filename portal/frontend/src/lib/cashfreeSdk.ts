// Loads Cashfree's hosted-checkout JS SDK (v3) on demand and starts a checkout
// for a payment session. The script is loaded from Cashfree's CDN so nothing is
// shipped in our bundle; failures surface as a rejected promise the caller can
// show inline.

type CashfreeMode = 'sandbox' | 'production';

type CheckoutOptions = {
  paymentSessionId: string;
  redirectTarget?: '_self' | '_blank' | '_modal';
};

type CashfreeInstance = {
  checkout: (options: CheckoutOptions) => Promise<unknown>;
};

type CashfreeFactory = (options: { mode: CashfreeMode }) => CashfreeInstance;

declare global {
  interface Window {
    Cashfree?: CashfreeFactory;
  }
}

const SDK_SRC = 'https://sdk.cashfree.com/js/v3/cashfree.js';

let loader: Promise<CashfreeFactory> | null = null;

export function loadCashfreeSdk(): Promise<CashfreeFactory> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Cashfree checkout is only available in the browser'));
  }
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  if (!loader) {
    loader = new Promise<CashfreeFactory>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-cashfree-sdk]');
      const script = existing ?? document.createElement('script');
      script.src = SDK_SRC;
      script.async = true;
      script.dataset.cashfreeSdk = 'true';
      script.addEventListener('load', () => {
        if (window.Cashfree) resolve(window.Cashfree);
        else reject(new Error('The Cashfree checkout SDK failed to initialise'));
      });
      script.addEventListener('error', () =>
        reject(new Error('Could not load the Cashfree checkout SDK'))
      );
      if (!existing) document.head.appendChild(script);
    });
  }
  return loader;
}

export async function openCashfreeCheckout(input: {
  mode: CashfreeMode;
  paymentSessionId: string;
}): Promise<void> {
  const factory = await loadCashfreeSdk();
  const instance = factory({ mode: input.mode });
  await instance.checkout({
    paymentSessionId: input.paymentSessionId,
    redirectTarget: '_self',
  });
}
