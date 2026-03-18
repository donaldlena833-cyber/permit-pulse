import { RefreshCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/features/permit-pulse/components/page-header"
import { SectionCard } from "@/features/permit-pulse/components/section-card"
import { formatCurrency } from "@/features/permit-pulse/lib/format"
import type { TenantProfile } from "@/types/permit-pulse"

interface ProfileSettingsViewProps {
  profile: TenantProfile
  onUpdate: (patch: Partial<TenantProfile>) => void
  onReset: () => void
}

function asCommaList(values: string[]): string {
  return values.join(", ")
}

function toList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function ProfileSettingsView({ profile, onUpdate, onReset }: ProfileSettingsViewProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        action={
          <Button className="rounded-full" onClick={onReset} type="button" variant="outline">
            <RefreshCcw className="h-4 w-4" />
            Reset to MetroGlassPro baseline
          </Button>
        }
        description="The profile drives which permits look like MetroGlassPro work, how strongly they score, and how hard PermitPulse should push them toward outreach."
        eyebrow="Profile / Scoring Settings"
        title="ICP, service fit, and scoring logic in one place."
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <SectionCard
          description="MetroGlassPro-first service focus, trade fit, and borough targeting."
          title="Ideal customer profile"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Target services</label>
              <Textarea
                className="min-h-[110px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                onChange={(event) => onUpdate({ targetServices: toList(event.target.value) })}
                value={asCommaList(profile.targetServices)}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Business name</label>
                <Input
                  className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                  onChange={(event) => onUpdate({ businessName: event.target.value })}
                  value={profile.businessName}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Website</label>
                <Input
                  className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                  onChange={(event) => onUpdate({ website: event.target.value })}
                  value={profile.website}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Primary boroughs</label>
                <Input
                  className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                  onChange={(event) => onUpdate({ primaryBoroughs: toList(event.target.value) })}
                  value={asCommaList(profile.primaryBoroughs)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Secondary boroughs</label>
                <Input
                  className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                  onChange={(event) => onUpdate({ secondaryBoroughs: toList(event.target.value) })}
                  value={asCommaList(profile.secondaryBoroughs)}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Sweet spot minimum</label>
                <Input
                  className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                  onChange={(event) => onUpdate({ sweetSpotCostMin: Number.parseInt(event.target.value || "0", 10) })}
                  type="number"
                  value={profile.sweetSpotCostMin}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Sweet spot maximum</label>
                <Input
                  className="rounded-2xl border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                  onChange={(event) => onUpdate({ sweetSpotCostMax: Number.parseInt(event.target.value || "0", 10) })}
                  type="number"
                  value={profile.sweetSpotCostMax}
                />
              </div>
            </div>
            <div className="rounded-[22px] border border-navy-200/70 bg-cream-50/70 p-4 dark:border-dark-border/70 dark:bg-dark-bg">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-navy-400 dark:text-dark-muted">
                Budget lane
              </div>
              <p className="mt-2 text-sm leading-6 text-navy-600 dark:text-dark-muted">
                Current scoring sweet spot: {formatCurrency(profile.sweetSpotCostMin)} to {formatCurrency(profile.sweetSpotCostMax)}
              </p>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          description="Keywords, fit signals, and excluded patterns that determine what bubbles up."
          title="Signal definitions"
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Direct keywords</label>
              <Textarea
                className="min-h-[120px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                onChange={(event) => onUpdate({ directKeywords: toList(event.target.value) })}
                value={asCommaList(profile.directKeywords)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Inferred need keywords</label>
              <Textarea
                className="min-h-[120px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                onChange={(event) => onUpdate({ inferredKeywords: toList(event.target.value) })}
                value={asCommaList(profile.inferredKeywords)}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Commercial signals</label>
                <Textarea
                  className="min-h-[110px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                  onChange={(event) => onUpdate({ commercialSignals: toList(event.target.value) })}
                  value={asCommaList(profile.commercialSignals)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Building / client types</label>
                <Textarea
                  className="min-h-[110px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                  onChange={(event) =>
                    onUpdate({
                      buildingSignals: toList(event.target.value),
                      buildingClientTypes: toList(event.target.value),
                    })
                  }
                  value={asCommaList(profile.buildingSignals)}
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Excluded permit patterns</label>
                <Textarea
                  className="min-h-[110px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                  onChange={(event) => onUpdate({ excludeKeywords: toList(event.target.value) })}
                  value={asCommaList(profile.excludeKeywords)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-navy-700 dark:text-dark-text">Blacklist / ignore list</label>
                <Textarea
                  className="min-h-[110px] rounded-[24px] border-navy-200 bg-white/90 dark:border-dark-border dark:bg-dark-card"
                  onChange={(event) => onUpdate({ blacklist: toList(event.target.value) })}
                  value={asCommaList(profile.blacklist)}
                />
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        description="Adjust the relative pull of fit, timing, location, and contactability."
        title="Scoring weights"
      >
        <div className="grid gap-6 xl:grid-cols-3">
          {(
            [
              ["directKeyword", "Direct keyword"],
              ["inferredNeed", "Inferred need"],
              ["costSignal", "Budget fit"],
              ["commercialSignal", "Commercial"],
              ["buildingTypeSignal", "Building type"],
              ["recencyBonus", "Recency"],
              ["locationBonus", "Location"],
              ["negativeSignal", "Negative signal"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="rounded-[24px] border border-navy-200/70 bg-cream-50/70 p-4 dark:border-dark-border/70 dark:bg-dark-bg">
              <div className="flex items-center justify-between text-sm font-medium text-navy-700 dark:text-dark-text">
                <span>{label}</span>
                <span>{profile.scoringWeights[key]}</span>
              </div>
              <Slider
                className="mt-4"
                max={40}
                min={0}
                onValueChange={([value]) =>
                  onUpdate({
                    scoringWeights: {
                      ...profile.scoringWeights,
                      [key]: value,
                    },
                  })
                }
                step={1}
                value={[profile.scoringWeights[key]]}
              />
            </div>
          ))}
          <div className="rounded-[24px] border border-navy-200/70 bg-cream-50/70 p-4 dark:border-dark-border/70 dark:bg-dark-bg">
            <div className="flex items-center justify-between text-sm font-medium text-navy-700 dark:text-dark-text">
              <span>Contactability weight</span>
              <span>{profile.contactabilityWeight}</span>
            </div>
            <Slider
              className="mt-4"
              max={40}
              min={0}
              onValueChange={([value]) => onUpdate({ contactabilityWeight: value })}
              step={1}
              value={[profile.contactabilityWeight]}
            />
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
