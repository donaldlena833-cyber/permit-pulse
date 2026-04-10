const STORAGE_KEY = "metroglass-leads-auth-session"
const SESSION_VAULT_KEY = "metroglass-leads-auth-sessions"
const REFRESH_WINDOW_MS = 5 * 60 * 1000
const LOGIN_IDENTIFIER_ALIASES: Record<string, string> = {
  operations: "operations@metroglasspro.com",
  metroglasspro: "operations@metroglasspro.com",
  lokeil: "info@lokeilremodeling.com",
}
const SESSION_LABELS: Record<string, string> = {
  "operations@metroglasspro.com": "MetroGlass Pro",
  "info@lokeilremodeling.com": "Lokeil",
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

interface StoredSessionVault {
  activeEmail: string | null
  sessions: Record<string, AuthSession>
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

function normalizeSessionKey(value: string): string {
  return String(value || "").trim().toLowerCase()
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

function isValidSession(value: unknown): value is AuthSession {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as AuthSession).accessToken === "string"
    && typeof (value as AuthSession).refreshToken === "string"
    && typeof (value as AuthSession).expiresAt === "number"
    && typeof (value as AuthSession).user?.email === "string",
  )
}

function readLegacySession(): AuthSession | null {
  if (!isBrowser()) {
    return null
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY)
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown
    return isValidSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizeVault(value: unknown): StoredSessionVault {
  const sessions: Record<string, AuthSession> = {}
  let activeEmail: string | null = null

  if (value && typeof value === "object") {
    const rawVault = value as { activeEmail?: unknown; sessions?: unknown }
    if (rawVault.sessions && typeof rawVault.sessions === "object") {
      for (const [email, session] of Object.entries(rawVault.sessions as Record<string, unknown>)) {
        if (isValidSession(session)) {
          sessions[normalizeSessionKey(email)] = session
        }
      }
    }

    if (typeof rawVault.activeEmail === "string") {
      activeEmail = normalizeSessionKey(rawVault.activeEmail)
    }
  }

  const sessionEmails = Object.keys(sessions)
  if (!activeEmail || !sessions[activeEmail]) {
    activeEmail = sessionEmails[0] || null
  }

  return {
    activeEmail,
    sessions,
  }
}

function readSessionVault(): StoredSessionVault {
  if (!isBrowser()) {
    return {
      activeEmail: null,
      sessions: {},
    }
  }

  const rawVault = window.localStorage.getItem(SESSION_VAULT_KEY)
  if (rawVault) {
    try {
      return normalizeVault(JSON.parse(rawVault) as unknown)
    } catch {
      // Fall through to the legacy single-session storage.
    }
  }

  const legacySession = readLegacySession()
  if (!legacySession) {
    return {
      activeEmail: null,
      sessions: {},
    }
  }

  const email = normalizeSessionKey(legacySession.user.email)
  return {
    activeEmail: email,
    sessions: {
      [email]: legacySession,
    },
  }
}

function writeSessionVault(vault: StoredSessionVault) {
  if (!isBrowser()) {
    return
  }

  const normalized = normalizeVault(vault)
  const sessionEmails = Object.keys(normalized.sessions)

  if (sessionEmails.length === 0) {
    window.localStorage.removeItem(SESSION_VAULT_KEY)
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }

  window.localStorage.setItem(SESSION_VAULT_KEY, JSON.stringify(normalized))

  const activeSession = normalized.activeEmail ? normalized.sessions[normalized.activeEmail] : null
  if (activeSession) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(activeSession))
  } else {
    window.localStorage.removeItem(STORAGE_KEY)
  }
}

function saveSession(session: AuthSession | null) {
  if (!isBrowser()) {
    return
  }

  if (!session) {
    window.localStorage.removeItem(SESSION_VAULT_KEY)
    window.localStorage.removeItem(STORAGE_KEY)
    return
  }

  const vault = readSessionVault()
  const email = normalizeSessionKey(session.user.email)
  vault.sessions[email] = session
  vault.activeEmail = email
  writeSessionVault(vault)
}

export function listStoredSessions(): AuthSession[] {
  const vault = readSessionVault()
  const orderedEmails = [
    vault.activeEmail,
    ...Object.keys(vault.sessions).filter((email) => email !== vault.activeEmail),
  ].filter((email): email is string => Boolean(email))

  return orderedEmails
    .map((email) => vault.sessions[email])
    .filter((session): session is AuthSession => Boolean(session))
}

export function getSessionDisplayName(email: string | null | undefined): string {
  const normalized = normalizeSessionKey(email || "")
  if (!normalized) {
    return "Saved user"
  }

  return SESSION_LABELS[normalized] || normalized
}

export function switchStoredSession(email: string): AuthSession | null {
  const vault = readSessionVault()
  const normalized = normalizeSessionKey(email)
  const session = vault.sessions[normalized] || null

  if (!session) {
    return null
  }

  vault.activeEmail = normalized
  writeSessionVault(vault)
  return session
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
  const vault = readSessionVault()
  return vault.activeEmail ? vault.sessions[vault.activeEmail] || null : null
}

export function clearStoredSession() {
  saveSession(null)
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
  saveSession(nextSession)
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
  saveSession(null)

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
  saveSession(session)
  return session
}
