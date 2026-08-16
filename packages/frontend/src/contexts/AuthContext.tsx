import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { User as SupabaseUser, Session } from '@supabase/supabase-js';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  plan: 'free' | 'starter' | 'pro' | 'enterprise' | 'unlimited';
  avatar_url?: string;
  createdAt: string;
  active: boolean;
  subscription_end: string | null;
}

interface AuthContextType {
  user: User | null;
  supabaseUser: SupabaseUser | null;
  session: Session | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; isAdmin: boolean }>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<boolean>;
  updateUser: (updates: Partial<User>) => Promise<void>;
}

const authContextFallback: AuthContextType = {
  user: null,
  supabaseUser: null,
  session: null,
  isLoading: false,
  login: async () => ({ success: false, isAdmin: false }),
  logout: async () => {},
  resetPassword: async () => false,
  updateUser: async () => {},
};

const AuthContext = createContext<AuthContextType>(authContextFallback);

export function AuthProvider({ children }: { children: ReactNode }) {
  const AUTH_INIT_TIMEOUT_MS = 12000;
  const [user, setUser] = useState<User | null>(null);
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Monta o User a partir de profiles, caindo na sessao quando a linha nao
   * existe. Recebe o usuario do Auth inteiro, e nao so o id, justamente para
   * ter esse fallback.
   */
  const fetchUserProfile = async (authUser: SupabaseUser): Promise<User | null> => {
    const userId = authUser.id;

    // Identidade derivada so da sessao. E o que o app usa quando profiles
    // ainda nao tem linha para esta pessoa.
    const fromSession = (): User => ({
      id: userId,
      name: (authUser.user_metadata?.name as string) || authUser.email?.split('@')[0] || '',
      email: authUser.email || '',
      role: 'user',
      plan: 'unlimited',
      avatar_url: undefined,
      createdAt: authUser.created_at,
      active: true,
      subscription_end: null,
    });

    try {
      // Nao ha mais plano nem papel: a cobranca e o painel admin sairam do
      // produto, e com eles as tabelas plan_rules e user_roles. Consultar as
      // duas aqui fazia esta funcao devolver null e o login nunca redirecionar.
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('name, email, avatar_url, created_at, active')
        .eq('user_id', userId)
        .maybeSingle();

      // Nem erro de consulta nem ausencia de linha podem barrar o login. A
      // identidade real vem do Auth; profiles e um registro de conveniencia.
      // Barrar aqui devolvia a pessoa pro login sem mensagem nenhuma — nao
      // entra e nao explica, que e o pior dos dois mundos.
      if (profileError) {
        console.error('[Auth] Falha ao ler profiles, usando a sessao:', profileError);
        return fromSession();
      }

      if (!profile) {
        console.warn('[Auth] Sem linha em profiles para', userId, '— usando a sessao.');
        return fromSession();
      }

      return {
        id: userId,
        name: profile.name || '',
        email: profile.email || '',
        // Mantidos no tipo porque varias telas os leem. Com um so usuario e
        // sem cobranca, os valores sao constantes.
        role: 'user',
        plan: 'unlimited',
        avatar_url: profile.avatar_url,
        createdAt: profile.created_at,
        active: profile.active ?? true,
        subscription_end: null,
      };
    } catch (error) {
      console.error('Error in fetchUserProfile:', error);
      return null;
    }
  };

  useEffect(() => {
    let isMounted = true;

    // Listener for ONGOING auth changes (does NOT control isLoading)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, currentSession) => {
        if (!isMounted) return;
        setSession(currentSession);
        setSupabaseUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          fetchUserProfile(currentSession.user).then((profile) => {
            if (isMounted) setUser(profile);
          });
        } else {
          setUser(null);
        }
      }
    );

    // INITIAL load (controls isLoading)
    const initializeAuth = async () => {
      let completed = false;
      const timeoutId = window.setTimeout(() => {
        if (isMounted && !completed) {
          console.warn('[Auth] Session init timeout, liberando UI.');
          setIsLoading(false);
        }
      }, AUTH_INIT_TIMEOUT_MS);

      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!isMounted) return;

        setSession(currentSession);
        setSupabaseUser(currentSession?.user ?? null);

        if (currentSession?.user) {
          const profile = await fetchUserProfile(currentSession.user);
          if (isMounted) setUser(profile);
        }
      } catch (error) {
        console.error('[Auth] Failed to initialize session:', error);
      } finally {
        completed = true;
        window.clearTimeout(timeoutId);
        if (isMounted) setIsLoading(false);
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [AUTH_INIT_TIMEOUT_MS]);

  const login = async (email: string, password: string): Promise<{ success: boolean; isAdmin: boolean }> => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Login error:', error.message);
        return { success: false, isAdmin: false };
      }

      if (data.user) {
        // Fetch profile and role BEFORE returning so ProtectedRoute sees the user
        const profile = await fetchUserProfile(data.user);
        setUser(profile);
        setSupabaseUser(data.user);
        setSession(data.session);

        const isAdmin = profile?.role === 'admin';
        return { success: true, isAdmin };
      }

      return { success: false, isAdmin: false };
    } catch (error) {
      console.error('Login exception:', error);
      return { success: false, isAdmin: false };
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setSupabaseUser(null);
      setSession(null);
      localStorage.removeItem('adsTracker_needsOnboarding');
      sessionStorage.removeItem('sentinel_auto_synced');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const resetPassword = async (email: string): Promise<boolean> => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (error) {
        console.error('Reset password error:', error.message);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Reset password exception:', error);
      return false;
    }
  };

  const updateUser = async (updates: Partial<User>) => {
    if (!supabaseUser) return;

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          name: updates.name,
          avatar_url: updates.avatar_url,
        })
        .eq('user_id', supabaseUser.id);

      if (error) throw error;

      // Refresh profile
      const profile = await fetchUserProfile(supabaseUser);
      if (profile) {
        setUser(profile);
      }
    } catch (error) {
      console.error('Error updating user:', error);
    }
  };

  return (
    <AuthContext.Provider 
      value={{ 
        user, 
        supabaseUser, 
        session, 
        isLoading, 
        login, 
        logout, 
        resetPassword, 
        updateUser 
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
