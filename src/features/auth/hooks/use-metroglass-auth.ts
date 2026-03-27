import { useCallback, useEffect, useState } from "react"

import {
  clearStoredSession,
  ensureSession,
  type AuthSession,
  signInWithPassword,
  signOutSession,
} from "@/features/auth/lib/session"

type AuthStatus = "loading" | "authenticated" | "unauthenticated"

export function useMetroglassAuth() {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [session, setSession] = useState<AuthSession | null>(null)
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
        setStatus(nextSession ? "authenticated" : "unauthenticated")
        setError(null)
      } catch (hydrateError) {
        if (cancelled) {
          return
        }
        clearStoredSession()
        setSession(null)
        setStatus("unauthenticated")
        setError(hydrateError instanceof Error ? hydrateError.message : "Session restore failed")
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handleExpired = () => {
      clearStoredSession()
      setSession(null)
      setStatus("unauthenticated")
      setError("Your session expired. Sign in again to keep using MetroGlass Leads.")
    }

    window.addEventListener("metroglass-auth-expired", handleExpired)
    return () => window.removeEventListener("metroglass-auth-expired", handleExpired)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const nextSession = await ensureSession()
      setSession(nextSession)
      setStatus(nextSession ? "authenticated" : "unauthenticated")
      setError(null)
    } catch (hydrateError) {
      clearStoredSession()
      setSession(null)
      setStatus("unauthenticated")
      setError(hydrateError instanceof Error ? hydrateError.message : "Session restore failed")
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
      setSession(nextSession)
      setStatus("authenticated")
      return nextSession
    } catch (loginError) {
      setSession(null)
      setStatus("unauthenticated")
      const message = loginError instanceof Error ? loginError.message : "Login failed"
      const friendlyMessage = message.toLowerCase().includes("email not confirmed")
        ? "Your Supabase project is still requiring email confirmation. Confirm the inbox for operations@metroglasspro.com, or disable email confirmation in Supabase Auth."
        : message
      setError(friendlyMessage)
      throw loginError
    }
  }, [])

  const logout = useCallback(async () => {
    await signOutSession()
    setSession(null)
    setStatus("unauthenticated")
    setError(null)
  }, [])

  return {
    status,
    session,
    error,
    login,
    logout,
    refresh,
  }
}
