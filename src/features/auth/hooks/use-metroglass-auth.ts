import { useCallback, useEffect, useState } from "react"

import {
  clearStoredSession,
  ensureSession,
  type AuthSession,
  signInWithPassword,
  signOutSession,
} from "@/features/auth/lib/session"
import { fetchTenantMe } from "@/features/metroglass-leads/lib/remote"
import type { TenantProfile } from "@/features/metroglass-leads/types/api"

type AuthStatus = "loading" | "authenticated" | "unauthenticated"

export function useMetroglassAuth() {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [session, setSession] = useState<AuthSession | null>(null)
  const [tenant, setTenant] = useState<TenantProfile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const nextSession = await ensureSession()
        if (cancelled) {
          return
        }
        setSession(nextSession)
        if (!nextSession) {
          setTenant(null)
          setStatus("unauthenticated")
          setError(null)
          return
        }
        const nextTenant = await fetchTenantMe()
        if (cancelled) {
          return
        }
        setTenant(nextTenant)
        setStatus("authenticated")
        setError(null)
      } catch (hydrateError) {
        if (cancelled) {
          return
        }
        clearStoredSession()
        setSession(null)
        setTenant(null)
        setStatus("unauthenticated")
        setError(hydrateError instanceof Error ? hydrateError.message : "Session restore failed")
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const nextSession = await ensureSession()
      setSession(nextSession)
      if (!nextSession) {
        setTenant(null)
        setStatus("unauthenticated")
        setError(null)
        return null
      }
      const nextTenant = await fetchTenantMe()
      setTenant(nextTenant)
      setStatus("authenticated")
      setError(null)
      return nextTenant
    } catch (hydrateError) {
      clearStoredSession()
      setSession(null)
      setTenant(null)
      setStatus("unauthenticated")
      setError(hydrateError instanceof Error ? hydrateError.message : "Session restore failed")
      return null
    }
  }, [])

  useEffect(() => {
    if (status !== "authenticated") {
      return undefined
    }

    const interval = window.setInterval(() => {
      void refresh()
    }, 10 * 60 * 1000)

    return () => window.clearInterval(interval)
  }, [refresh, status])

  const login = useCallback(async (email: string, password: string) => {
    setStatus("loading")
    setError(null)
    try {
      const nextSession = await signInWithPassword(email, password)
      const nextTenant = await fetchTenantMe()
      setSession(nextSession)
      setTenant(nextTenant)
      setStatus("authenticated")
      return nextSession
    } catch (loginError) {
      setSession(null)
      setTenant(null)
      setStatus("unauthenticated")
      const message = loginError instanceof Error ? loginError.message : "Login failed"
      const friendlyMessage = message.toLowerCase().includes("email not confirmed")
        ? "Your Supabase project is still requiring email confirmation. Confirm the inbox for this tenant account, or disable email confirmation in Supabase Auth."
        : message
      setError(friendlyMessage)
      throw loginError
    }
  }, [])

  const logout = useCallback(async () => {
    await signOutSession()
    setSession(null)
    setTenant(null)
    setStatus("unauthenticated")
    setError(null)
  }, [])

  return {
    status,
    session,
    tenant,
    setTenant,
    error,
    login,
    logout,
    refresh,
  }
}
