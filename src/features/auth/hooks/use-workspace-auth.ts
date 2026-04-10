import { useCallback, useEffect, useState } from "react"

import {
  AUTH_SESSION_CHANGED_EVENT,
  clearStoredSession,
  ensureSession,
  type AuthSession,
  signInWithPassword,
  signUpWithPassword,
  signOutSession,
} from "@/features/auth/lib/session"

type AuthStatus = "loading" | "authenticated" | "unauthenticated"

export function useWorkspaceAuth() {
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

  const refresh = useCallback(async (): Promise<AuthSession | null> => {
    try {
      const nextSession = await ensureSession()
      setSession(nextSession)
      setStatus(nextSession ? "authenticated" : "unauthenticated")
      setError(null)
      return nextSession
    } catch (hydrateError) {
      clearStoredSession()
      setSession(null)
      setStatus("unauthenticated")
      setError(hydrateError instanceof Error ? hydrateError.message : "Session restore failed")
      return null
    }
  }, [])

  useEffect(() => {
    const handleSessionChange = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason
      void (async () => {
        const nextSession = await refresh()
        if (!nextSession && reason === "expired") {
          setError("Your session expired. Please sign in again.")
        }
      })()
    }

    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, handleSessionChange as EventListener)
    return () => window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, handleSessionChange as EventListener)
  }, [refresh])

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
        ? "Your Supabase project is still requiring email confirmation. Confirm the inbox for the workspace email you signed up with, or disable email confirmation in Supabase Auth."
        : message
      setError(friendlyMessage)
      throw loginError
    }
  }, [])

  const signup = useCallback(async (email: string, password: string) => {
    setStatus("loading")
    setError(null)
    try {
      const nextSession = await signUpWithPassword(email, password)
      setSession(nextSession)
      setStatus("authenticated")
      return nextSession
    } catch (signupError) {
      setSession(null)
      setStatus("unauthenticated")
      const message = signupError instanceof Error ? signupError.message : "Signup failed"
      setError(message)
      throw signupError
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
    signup,
    logout,
    refresh,
  }
}
