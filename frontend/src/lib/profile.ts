'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { ApiError, profileApi, type Profile } from './api';

export interface UseProfile {
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  unauthorized: boolean;
  reload: () => Promise<void>;
}

// Fetches GET /api/profile for the signed-in user. Shared by the profile page
// and the top bar (avatar in the user menu). Follows the auth/session store:
// no user -> no profile, and a 401 surfaces through `unauthorized` so callers
// can sign out / redirect the way other protected views do.
export function useProfile(): UseProfile {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState<boolean>(false);

  const reload = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      setError(null);
      setUnauthorized(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setProfile(await profileApi.get());
    } catch (err) {
      const unauth = isUnauthorized(err);
      setUnauthorized(unauth);
      setError(err instanceof Error ? err.message : 'Failed to load profile');
      // On 401 the session is gone: drop the stale profile. For transient errors
      // keep the last-good profile on screen while `error` surfaces a notice.
      if (unauth) setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { profile, loading, error, unauthorized, reload };
}

export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}
