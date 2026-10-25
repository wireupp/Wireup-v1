import { createContext, useContext, useMemo, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './admin-layout'
import { OverviewPage } from './overview'
import { AccountsPage } from './accounts'
import { UsageExplorerPage } from './usage-explorer'
import { TokenAnalyticsPage } from './token-analytics'
import { CreditsPage } from './credits'
import { ModelsPage } from './models'
import { RateLimitsPage } from './rate-limits'
import { AlertsPage } from './alerts'
import { AuditPage } from './audit'
import { ReportsPage } from './reports'
import { SettingsPage } from './settings'
import type { PeriodKey } from '@/lib/admin/types'

// Global time-period selection lives at the shell level so the topbar selector
// and every analytics page share one source of truth.
interface PeriodContextValue { period: PeriodKey; setPeriod: (period: PeriodKey) => void }
const PeriodContext = createContext<PeriodContextValue>({ period: '7d', setPeriod: () => {} })

export function usePeriod(): PeriodContextValue {
  return useContext(PeriodContext)
}

// Console themes. `kind` drives which CSS helper classes the shell applies;
// `chart` carries recharts grid/tick colors that cannot read CSS variables.
export type AdminThemeId = 'midnight' | 'graphite' | 'ocean' | 'light' | 'duo' | 'duo-ocean'
export type AdminThemeKind = 'dark' | 'white' | 'mix'

export interface AdminThemeDef {
  id: AdminThemeId
  label: string
  kind: AdminThemeKind
  swatch: { bg: string; panel: string; accent: string; chrome?: string }
  chart: { grid: string; tick: string }
}

export const ADMIN_THEMES: AdminThemeDef[] = [
  { id: 'midnight', label: 'Midnight', kind: 'dark', swatch: { bg: '#0b0c0e', panel: '#141518', accent: '#4a8fd9' }, chart: { grid: '#23252b', tick: '#6b7280' } },
  { id: 'graphite', label: 'Graphite', kind: 'dark', swatch: { bg: '#131417', panel: '#1b1c20', accent: '#5b9be0' }, chart: { grid: '#2e3036', tick: '#8a919c' } },
  { id: 'ocean', label: 'Deep Ocean', kind: 'dark', swatch: { bg: '#0a1220', panel: '#101b2d', accent: '#4aa3e8' }, chart: { grid: '#1e2c44', tick: '#7f92b3' } },
  { id: 'light', label: 'Paper', kind: 'white', swatch: { bg: '#f5f6f8', panel: '#ffffff', accent: '#3273c4' }, chart: { grid: '#e3e6eb', tick: '#7a8494' } },
  { id: 'duo', label: 'Duo Slate', kind: 'mix', swatch: { bg: '#f5f6f8', panel: '#ffffff', accent: '#3273c4', chrome: '#12141a' }, chart: { grid: '#e3e6eb', tick: '#7a8494' } },
  { id: 'duo-ocean', label: 'Duo Ocean', kind: 'mix', swatch: { bg: '#f4f7fb', panel: '#ffffff', accent: '#2f7fd0', chrome: '#0c1526' }, chart: { grid: '#dfe6f0', tick: '#7186a6' } },
]

const DEFAULT_THEME: AdminThemeId = 'midnight'
const THEME_KEY = 'wireup.admin.theme'

function readInitialTheme(): AdminThemeId {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    // 'dark' was the pre-multi-theme value.
    if (stored === 'dark') return 'midnight'
    if (ADMIN_THEMES.some(themeDef => themeDef.id === stored)) return stored as AdminThemeId
  } catch { /* private mode — fall through to default */ }
  return DEFAULT_THEME
}

interface ThemeContextValue { theme: AdminThemeId; themeDef: AdminThemeDef; setTheme: (theme: AdminThemeId) => void }
const ThemeContext = createContext<ThemeContextValue>({ theme: DEFAULT_THEME, themeDef: ADMIN_THEMES[0], setTheme: () => {} })

export function useAdminTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

export function AdminApp() {
  const [period, setPeriod] = useState<PeriodKey>('7d')
  const [theme, setThemeState] = useState<AdminThemeId>(readInitialTheme)
  const periodValue = useMemo(() => ({ period, setPeriod }), [period])
  const themeValue = useMemo(() => {
    const themeDef = ADMIN_THEMES.find(candidate => candidate.id === theme) ?? ADMIN_THEMES[0]
    return {
      theme,
      themeDef,
      setTheme: (next: AdminThemeId) => {
        setThemeState(next)
        try { localStorage.setItem(THEME_KEY, next) } catch { /* theme just won't persist */ }
      },
    }
  }, [theme])
  return (
    <ThemeContext.Provider value={themeValue}>
      <PeriodContext.Provider value={periodValue}>
        <Routes>
          <Route element={<AdminLayout/>}>
            <Route index element={<OverviewPage/>}/>
            <Route path="accounts" element={<AccountsPage/>}/>
            <Route path="usage" element={<UsageExplorerPage/>}/>
            <Route path="tokens" element={<TokenAnalyticsPage/>}/>
            <Route path="credits" element={<CreditsPage/>}/>
            <Route path="models" element={<ModelsPage/>}/>
            <Route path="rate-limits" element={<RateLimitsPage/>}/>
            <Route path="alerts" element={<AlertsPage/>}/>
            <Route path="audit" element={<AuditPage/>}/>
            <Route path="reports" element={<ReportsPage/>}/>
            <Route path="settings" element={<SettingsPage/>}/>
            <Route path="*" element={<Navigate to="." replace/>}/>
          </Route>
        </Routes>
      </PeriodContext.Provider>
    </ThemeContext.Provider>
  )
}
