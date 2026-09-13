'use client';

import { useEffect, useRef, useState } from 'react';
import { eventsUrl, parseSseFrame } from '@/lib/realtime';

export interface RealtimeViewer {
  id: string;
  name: string | null;
}

export function useRoomEvents(
  room: string | null,
  onEvent?: (event: Record<string, unknown>) => void
): { connected: boolean; viewers: RealtimeViewer[] } {
  const [connected, setConnected] = useState(false);
  const [viewers, setViewers] = useState<RealtimeViewer[]>([]);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!room || typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setConnected(false);
      setViewers([]);
      return;
    }
    const source = new EventSource(eventsUrl(room));
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (message) => {
      const event = parseSseFrame(message.data);
      if (!event) return;
      if (event.type === 'presence' && Array.isArray((event as { viewers?: unknown }).viewers)) {
        setViewers((event as { viewers: RealtimeViewer[] }).viewers);
      }
      handlerRef.current?.(event as Record<string, unknown>);
    };
    return () => {
      source.close();
      setConnected(false);
      setViewers([]);
    };
  }, [room]);

  return { connected, viewers };
}
