import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { resolveSessionUserProfile } from '../utils/resolveSessionUserProfile';
import { evaluateClienteBillingAccess } from '../utils/billingAccessGate';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (session) => {
    if (!session || !isSupabaseConfigured) {
      setUserData(null);
      return null;
    }

    const profile = await resolveSessionUserProfile(session);
    if (!profile || profile.ativo === false) {
      await supabase.auth.signOut({ scope: 'local' });
      setUserData(null);
      return null;
    }

    const billing = await evaluateClienteBillingAccess(profile.cliente_id);
    if (!billing.allowed) {
      await supabase.auth.signOut({ scope: 'local' });
      setUserData(null);
      throw new Error(billing.reason || 'Acesso bloqueado');
    }

    setUserData(profile);
    return profile;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        await supabase.auth.signOut({ scope: 'local' });
        setLoading(false);
        return;
      }
      try {
        await loadProfile(session);
      } catch {
        setUserData(null);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setUserData(null);
        return;
      }
      if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        try {
          await loadProfile(session);
        } catch {
          setUserData(null);
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = useCallback(async (email, password) => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase não configurado. Verifique o arquivo .env');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error) throw error;

    const profile = await loadProfile(data.session);
    if (!profile) {
      throw new Error('Perfil de usuário não encontrado ou inativo.');
    }

    return profile;
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut({ scope: 'local' });
    }
    setUserData(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!isSupabaseConfigured) return null;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    return loadProfile(session);
  }, [loadProfile]);

  const value = useMemo(
    () => ({ userData, signIn, signOut, loading, isSupabaseConfigured, refreshProfile }),
    [userData, signIn, signOut, loading, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
