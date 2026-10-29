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
import { apiGet } from '../lib/api'
import { supabase } from '../lib/supabase'

export type SalonProfile = {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  storeEnabled: boolean
}

export type Me = {
  id: string | null
  email: string | null
  platformAdmin: boolean
  hasSalon: boolean
  enabledModules: string[]
  salon: SalonProfile | null
}

type AuthContextValue = {
  session: Session | null
  loading: boolean
  me: Me | null
  refreshMe: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
  me: null,
  refreshMe: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) setMe(null)
    })

    return () => data.subscription.unsubscribe()
  }, [])

  const refreshMe = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    const current = data.session
    if (!current) {
      setMe(null)
      return
    }

    try {
      setMe(await apiGet<Me>('/api/me', current.access_token))
    } catch {
      setMe({
        id: current.user.id,
        email: current.user.email ?? null,
        platformAdmin: false,
        hasSalon: false,
        enabledModules: [],
        salon: null,
      })
    }
  }, [])

  useEffect(() => {
    if (!session) {
      setMe(null)
      return
    }

    let cancelled = false
    apiGet<Me>('/api/me', session.access_token)
      .then((next) => {
        if (!cancelled) setMe(next)
      })
      .catch(() => {
        if (cancelled) return
        setMe({
          id: session.user.id,
          email: session.user.email ?? null,
          platformAdmin: false,
          hasSalon: false,
          enabledModules: [],
          salon: null,
        })
      })

    return () => {
      cancelled = true
    }
  }, [session])

  const value = useMemo(
    () => ({ session, loading, me, refreshMe }),
    [session, loading, me, refreshMe],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
