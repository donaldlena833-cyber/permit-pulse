import { DEFAULT_FILTERS, METROGLASSPRO_PROFILE } from "@/features/permit-pulse/data/profile"
import type { PermitPulseStore, TenantProfile } from "@/types/permit-pulse"

const STORAGE_KEY = "permit-pulse-v2"
const STORAGE_VERSION = 2

export function createInitialStore(profile: TenantProfile = METROGLASSPRO_PROFILE): PermitPulseStore {
  return {
    version: STORAGE_VERSION,
    theme: "light",
    section: "dashboard",
    activeViewId: "hot-today",
    enrichmentQueueId: "hot-missing-contact",
    outreachQueueId: "ready-email",
    filters: DEFAULT_FILTERS,
    profile,
    leads: {},
    selectedLeadId: null,
    lastScanAt: null,
  }
}

export function loadStore(profile: TenantProfile = METROGLASSPRO_PROFILE): PermitPulseStore {
  if (typeof window === "undefined") {
    return createInitialStore(profile)
  }

  const emptyStore = createInitialStore(profile)
  const rawValue = window.localStorage.getItem(STORAGE_KEY)

  if (!rawValue) {
    return emptyStore
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<PermitPulseStore>
    if (parsedValue.version !== STORAGE_VERSION) {
      return emptyStore
    }

    return {
      ...emptyStore,
      ...parsedValue,
      filters: {
        ...emptyStore.filters,
        ...parsedValue.filters,
      },
      profile: {
        ...profile,
        ...parsedValue.profile,
      },
      leads: parsedValue.leads ?? {},
    }
  } catch {
    return emptyStore
  }
}

export function saveStore(store: PermitPulseStore): void {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}
