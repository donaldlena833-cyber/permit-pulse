const STORAGE_KEY = "metroglass-leads-auth-session"
const REFRESH_WINDOW_MS = 5 * 60 * 1000
export const AUTH_SESSION_CHANGED_EVENT = "permit-pulse-auth-session-changed"

const LOGIN_IDENTIFIER_ALIASES: Record<string, string> = {
  operations: "operations@metroglasspro.com",
  metroglasspro: "operations@metroglasspro.com",
  lokeil: "info@lokeilremodeling.com",
}

export interface AuthUser {
  id: string
  email: string
}

export interface AuthSession {
  accessToken: string
  refreshToken: string
  expiresAt: number
  user: AuthUser
}

interface SupabaseAuthPayload {
  access_token: string
  refresh_token: string
  expires_at?: number
  expires_in?: number
  user?: {
    id?: string
    email?: string
  }
}

interface AuthSessionChangeDetail {
  reason: "saved" | "cleared" | "expired" | "signed-out" | "refreshed"
}

function isBrowser(): boolean {
  return typeof window !== "undefined"
}

function getSupabaseUrl(): string {
  return __SUPABASE_URL__.replace(/\/$/, "")
}

function getSupabaseHeaders(token?: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    apikey: __SUPABASE_ANON_KEY__,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

function normalizeLoginIdentifier(value: string): string {
  const normalized = String(value || "").trim().toLowerCase()
  if (!normalized) {
    return normalized
  }

  if (normalized.includes("@")) {
    return normalized
  }

  return LOGIN_IDENTIFIER_ALIASES[normalized] ?? normalized
}

function normalizeSession(payload: SupabaseAuthPayload): AuthSession {
  const expiresAt = payload.expires_at
    ? payload.expires_at * 1000
    : Date.now() + Math.max((payload.expires_in ?? 3600) - 30, 30) * 1000

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt,
    user: {
      id: payload.user?.id ?? "",
      email: payload.user?.email ?? "",
    },
  }
}

function notifySessionChanged(reason: AuthSessionChangeDetail["reason"]) {
  if (!isBrowser()) {
    return
  }

  window.dispatchEvent(new CustomEvent<AuthSessionChangeDetail>(AUTH_SESSION_CHANGED_EVENT, {
    detail: { reason },
  }))
}

function saveSession(session: AuthSession | null, reason: AuthSessionChangeDetail["reason"] = session ? "saved" : "cleared") {
  if (!isBrowser()) {
    return
  }

  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY)
  } else {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
  }

  notifySessionChanged(reason)
}

async function requestAuth<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const response = await fetch(`${getSupabaseUrl()}/auth/v1${path}`, {
    ...init,
    headers: {
      ...getSupabaseHeaders(token),
      ...(init.headers ?? {}),
    },
  })

  const payload = (await response.json().catch(() => null)) as T | { error_description?: string; msg?: string } | null

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error_description" in payload && payload.error_description
        ? payload.error_description
        : payload && typeof payload === "object" && "msg" in payload && payload.msg
          ? payload.msg
          : `Auth request failed with ${response.status}`
    throw new Error(message)
  }

  return payload as T
}

export function loadStoredSession(): AuthSession | null {
  if (!isBrowser()) {
    return null
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY)
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as AuthSession
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.expiresAt || !parsed.user?.email) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearStoredSession(reason: AuthSessionChangeDetail["reason"] = "cleared") {
  saveSession(null, reason)
}

export function getAccessToken(): string | null {
  return loadStoredSession()?.accessToken ?? null
}

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
  const payload = await requestAuth<SupabaseAuthPayload>(
    "/token?grant_type=password",
    {
      method: "POST",
      body: JSON.stringify({ email: normalizeLoginIdentifier(email), password }),
    },
  )

  const session = normalizeSession(payload)
  saveSession(session)
  return session
}

export async function refreshStoredSession(currentSession?: AuthSession | null): Promise<AuthSession | null> {
  const session = currentSession ?? loadStoredSession()
  if (!session?.refreshToken) {
    return null
  }

  const payload = await requestAuth<SupabaseAuthPayload>(
    "/token?grant_type=refresh_token",
    {
      method: "POST",
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    },
  )

  const nextSession = normalizeSession(payload)
  saveSession(nextSession, "refreshed")
  return nextSession
}

export async function ensureSession(): Promise<AuthSession | null> {
  const session = loadStoredSession()
  if (!session) {
    return null
  }

  if (session.expiresAt - Date.now() > REFRESH_WINDOW_MS) {
    return session
  }

  try {
    return await refreshStoredSession(session)
  } catch {
    clearStoredSession()
    return null
  }
}

export async function signOutSession() {
  const session = loadStoredSession()
  saveSession(null, "signed-out")

  if (!session?.accessToken) {
    return
  }

  try {
    await requestAuth(
      "/logout",
      {
        method: "POST",
      },
      session.accessToken,
    )
  } catch {
    return
  }
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthSession> {
  const payload = await requestAuth<SupabaseAuthPayload>(
    "/signup",
    {
      method: "POST",
      body: JSON.stringify({ email: normalizeLoginIdentifier(email), password }),
    },
  )

  const session = normalizeSession(payload)
  saveSession(session, "saved")
  return session
}
