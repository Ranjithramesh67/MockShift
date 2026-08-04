'use client';

import React, { useEffect } from 'react';
import { useApp } from '@/store/AppStore';
import { CheckIcon, AlertIcon, InfoIcon } from './icons';

export function ToastHost() {
  const { state, dispatch } = useApp();
  const toast = state.toast;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => dispatch({ type: 'DISMISS_TOAST' }), 3500);
    return () => clearTimeout(timer);
  }, [toast, dispatch]);

  if (!toast) return null;

  const Icon = toast.kind === 'success' ? CheckIcon : toast.kind === 'error' ? AlertIcon : InfoIcon;

  return (
    <div className={`toast toast-${toast.kind}`} data-testid="toast" role="status">
      <Icon size={16} />
      <span>{toast.message}</span>
    </div>
  );
}
