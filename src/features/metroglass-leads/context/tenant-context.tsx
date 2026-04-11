import { createContext, useContext } from "react"

import type { TenantProfile } from "@/features/metroglass-leads/types/api"

interface TenantContextValue {
  tenant: TenantProfile | null
  setTenant: (tenant: TenantProfile | null) => void
}

export const TenantContext = createContext<TenantContextValue | null>(null)

export function useTenantContext() {
  const value = useContext(TenantContext)
  if (!value) {
    throw new Error("TenantContext is not available")
  }
  return value
}
