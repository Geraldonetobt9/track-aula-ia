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
  register: (name: string, email: string, password: string) => Promise<boolean>;
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
  register: async () => false,
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

  // Fetch user profile from database
  const fetchUserProfile = async (userId: string): Promise<User | null> => {
    try {
      // Fetch profile
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*, plan_rules:plan_id(plan)')
        .eq('user_id', userId)
        .maybeSingle();

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        return null;
      }

      // Fetch role
      const { data: roleData, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();

      if (roleError) {
        console.error('Error fetching role:', roleError);
      }

      if (profile) {
        return {
          id: userId,
          name: profile.name || '',
          email: profile.email || '',
          role: (roleData?.role as 'admin' | 'user') || 'user',
          plan: ((profile.plan_rules as any)?.plan as User['plan']) || 'free',
          avatar_url: profile.avatar_url,
          createdAt: profile.created_at,
          active: profile.active ?? true,
          subscription_end: profile.subscription_end ?? null,
        };
      }

      return null;
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
          fetchUserProfile(currentSession.user.id).then((profile) => {
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
          const profile = await fetchUserProfile(currentSession.user.id);
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
        const profile = await fetchUserProfile(data.user.id);
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

  const register = async (name: string, email: string, password: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            name: name,
          },
        },
      });

      if (error) {
        console.error('Register error:', error.message);
        return false;
      }

      // Mark as needing onboarding and send welcome email
      if (data.user) {
        localStorage.setItem('adsTracker_needsOnboarding', 'true');
        
        // Send welcome email via backend API (fire-and-forget)
        // The n8n-profiles webhook processor handles welcome emails automatically
        // when a new profile is created, so no explicit call is needed here.
      }

      return !!data.user;
    } catch (error) {
      console.error('Register exception:', error);
      return false;
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
      const profile = await fetchUserProfile(supabaseUser.id);
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
        register, 
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
