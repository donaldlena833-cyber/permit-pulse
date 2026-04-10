import { useCallback, useEffect, useState } from "react"

import {
  clearStoredSession,
  ensureSession,
  getSessionDisplayName,
  type AuthSession,
  listStoredSessions,
  signInWithPassword,
  signUpWithPassword,
  signOutSession,
  switchStoredSession,
} from "@/features/auth/lib/session"

type AuthStatus = "loading" | "authenticated" | "unauthenticated"

export function useWorkspaceAuth() {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [session, setSession] = useState<AuthSession | null>(null)
  const [storedSessions, setStoredSessions] = useState<AuthSession[]>(() => listStoredSessions())
  const [error, setError] = useState<string | null>(null)

  const syncStoredSessions = useCallback(() => {
    setStoredSessions(listStoredSessions())
  }, [])

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
        syncStoredSessions()
      } catch (hydrateError) {
        if (cancelled) {
          return
        }
        clearStoredSession()
        setSession(null)
        setStatus("unauthenticated")
        setError(hydrateError instanceof Error ? hydrateError.message : "Session restore failed")
        syncStoredSessions()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [syncStoredSessions])

  const refresh = useCallback(async () => {
    try {
      const nextSession = await ensureSession()
      setSession(nextSession)
      setStatus(nextSession ? "authenticated" : "unauthenticated")
      setError(null)
      syncStoredSessions()
    } catch (hydrateError) {
      clearStoredSession()
      setSession(null)
      setStatus("unauthenticated")
      setError(hydrateError instanceof Error ? hydrateError.message : "Session restore failed")
      syncStoredSessions()
    }
  }, [syncStoredSessions])

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
      syncStoredSessions()
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
  }, [syncStoredSessions])

  const switchSession = useCallback(async (email: string) => {
    setError(null)
    const nextSession = switchStoredSession(email)
    if (!nextSession) {
      const message = `No saved session found for ${getSessionDisplayName(email)}`
      setError(message)
      throw new Error(message)
    }

    setSession(nextSession)
    setStatus("authenticated")
    syncStoredSessions()
    return nextSession
  }, [syncStoredSessions])

  const signup = useCallback(async (email: string, password: string) => {
    setStatus("loading")
    setError(null)
    try {
      const nextSession = await signUpWithPassword(email, password)
      setSession(nextSession)
      setStatus("authenticated")
      syncStoredSessions()
      return nextSession
    } catch (signupError) {
      setSession(null)
      setStatus("unauthenticated")
      const message = signupError instanceof Error ? signupError.message : "Signup failed"
      setError(message)
      throw signupError
    }
  }, [syncStoredSessions])

  const logout = useCallback(async () => {
    await signOutSession()
    setSession(null)
    setStatus("unauthenticated")
    setError(null)
    syncStoredSessions()
  }, [syncStoredSessions])

  return {
    status,
    session,
    storedSessions,
    error,
    login,
    switchSession,
    signup,
    logout,
    refresh,
  }
}
