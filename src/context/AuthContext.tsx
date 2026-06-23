import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { profileToAppUser, type AppUser, type Profile } from '../types/database'

interface AuthContextValue {
  user: AppUser | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (
    data: {
      email: string
      password: string
      full_name: string
      phone: string
    },
    referralCode?: string,
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchProfile(userId: string, email: string): Promise<AppUser | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()

  if (error || !data) {
    return {
      id: userId,
      email,
      full_name: '',
      phone: '',
      wallet_balance: 0,
      points_balance: 0,
      is_admin: false,
      topup_code: '',
      is_active: true,
      api_enabled: true,
    }
  }

  return profileToAppUser(data as Profile, email)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  const loadSessionUser = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession)

    if (!nextSession?.user) {
      setUser(null)
      return
    }

    const profile = await fetchProfile(
      nextSession.user.id,
      nextSession.user.email ?? '',
    )
    setUser(profile)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!session?.user) return
    const profile = await fetchProfile(session.user.id, session.user.email ?? '')
    setUser(profile)
  }, [session])

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      void loadSessionUser(data.session).finally(() => {
        if (mounted) setLoading(false)
      })
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void loadSessionUser(nextSession)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [loadSessionUser])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    return { error: error?.message ?? null }
  }, [])

  const signUp = useCallback(
    async (
      data: {
        email: string
        password: string
        full_name: string
        phone: string
      },
      referralCode?: string,
    ) => {
      const metadata: Record<string, string> = {
        full_name: data.full_name.trim(),
        phone: data.phone.trim(),
      }

      if (referralCode?.trim()) {
        metadata.referral_code = referralCode.trim().toUpperCase()
      }

      const { data: authData, error } = await supabase.auth.signUp({
        email: data.email.trim(),
        password: data.password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: metadata,
        },
      })

      if (error) {
        return { error: error.message }
      }

      if (authData.session) {
        await loadSessionUser(authData.session)
        return { error: null }
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email.trim(),
        password: data.password,
      })

      return { error: signInError?.message ?? null }
    },
    [loadSessionUser],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setSession(null)
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      session,
      loading,
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }),
    [user, session, loading, signIn, signUp, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export type { AppUser as User }
