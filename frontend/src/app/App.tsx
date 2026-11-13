import React, { Suspense, useEffect, useState, createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupApi, authApi } from '../lib/api'
import { AppLayout } from '../components/layout/AppLayout'
import { Spinner } from '../components/ui'

// ── Auth context — lives at the top of the React tree ────────────
// Never unmounts, never re-initialises, no storage timing issues
interface AuthUser {
  id: string; email: string; full_name: string; role: string
  is_active: boolean; avatar_initials: string
}
interface AuthCtx {
  token: string | null
  user:  AuthUser | null
  login: (token: string, refresh: string, user: AuthUser) => void
  logout: () => void
}
const AuthContext = createContext<AuthCtx>({
  token: null, user: null,
  login: () => {}, logout: () => {}
})
export function useAuth() { return useContext(AuthContext) }

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem('bp_token')
  )
  const [user, setUser] = useState<AuthUser | null>(() => {
    try { return JSON.parse(localStorage.getItem('bp_user') || 'null') } catch { return null }
  })

  const login = (t: string, r: string, u: AuthUser) => {
    localStorage.setItem('bp_token',   t)
    localStorage.setItem('bp_refresh', r)
    localStorage.setItem('bp_user',    JSON.stringify(u))
    setToken(t)
    setUser(u)
  }

  const logout = () => {
    localStorage.removeItem('bp_token')
    localStorage.removeItem('bp_refresh')
    localStorage.removeItem('bp_user')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// ── Lazy pages ────────────────────────────────────────────────────
const FirstRunPage       = React.lazy(() => import('../pages/FirstRun'))
const LoginPage          = React.lazy(() => import('../pages/Login').then(m => ({ default: m.LoginPage })))
const AzureAdCallbackPage = React.lazy(() => import('../pages/Login').then(m => ({ default: m.AzureAdCallbackPage })))
const ForgotPasswordPage = React.lazy(() => import('../pages/ForgotPassword').then(m => ({ default: m.ForgotPasswordPage })))
const ResetPasswordPage  = React.lazy(() => import('../pages/ResetPassword').then(m => ({ default: m.ResetPasswordPage })))
const ChangePasswordPage = React.lazy(() => import('../pages/ChangePassword').then(m => ({ default: m.ChangePasswordPage })))
const DashboardPage      = React.lazy(() => import('../pages/Dashboard').then(m => ({ default: m.DashboardPage })))
const OpportunitiesPage  = React.lazy(() => import('../pages/Opportunities').then(m => ({ default: m.OpportunitiesPage })))
const NewOpportunityPage = React.lazy(() => import('../pages/Opportunities').then(m => ({ default: m.NewOpportunityPage })))
const OpportunityDetail  = React.lazy(() => import('../pages/OpportunityDetail').then(m => ({ default: m.OpportunityDetailPage })))
const GenerationPage     = React.lazy(() => import('../pages/Generation').then(m => ({ default: m.GenerationPage })))
const OralsPage          = React.lazy(() => import('../pages/Orals').then(m => ({ default: m.OralsPage })))
const KnowledgeBasePage  = React.lazy(() => import('../pages/KnowledgeBase').then(m => ({ default: m.KnowledgeBasePage })))
const SettingsPage       = React.lazy(() => import('../pages/KnowledgeBase').then(m => ({ default: m.SettingsPage })))
const UsersPage          = React.lazy(() => import('../pages/KnowledgeBase').then(m => ({ default: m.UsersPage })))

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 }, mutations: { retry: 0 } },
})

function Fallback() {
  return <div className="flex items-center justify-center h-64"><Spinner className="w-6 h-6" /></div>
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token } = useAuth()
  const location = useLocation()
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}

function AppRoot() {
  const { token } = useAuth()
  const [phase, setPhase] = useState<'loading' | 'first-run' | 'app'>(() =>
    token ? 'app' : 'loading'
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (phase !== 'loading') return
    let tries = 0
    const check = () => {
      setupApi.getStatus()
        .then(res => setPhase(res.data?.first_run_completed === true ? 'app' : 'first-run'))
        .catch(() => {
          tries++
          setAttempt(tries)
          if (tries < 20) setTimeout(check, 1500)
          else setPhase('app')
        })
    }
    check()
  }, [phase])

  if (phase === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-sand-100">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl gradient-clay flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-xl font-bold">B</span>
          </div>
          <Spinner className="w-5 h-5 mx-auto text-clay-400" />
          <p className="text-xs text-smoke-500 mt-3">
            {attempt === 0 ? 'Starting...' : `Connecting... (${attempt})`}
          </p>
        </div>
      </div>
    )
  }

  if (phase === 'first-run') {
    return <Suspense fallback={<Fallback />}><FirstRunPage /></Suspense>
  }

  return (
    <Routes>
      <Route path="/login"           element={<Suspense fallback={<Fallback />}><LoginPage /></Suspense>} />
      <Route path="/auth/callback"   element={<Suspense fallback={<Fallback />}><AzureAdCallbackPage /></Suspense>} />
      <Route path="/forgot-password" element={<Suspense fallback={<Fallback />}><ForgotPasswordPage /></Suspense>} />
      <Route path="/reset-password"  element={<Suspense fallback={<Fallback />}><ResetPasswordPage /></Suspense>} />
      <Route path="/change-password" element={<RequireAuth><Suspense fallback={<Fallback />}><ChangePasswordPage forced={new URLSearchParams(window.location.search).get('forced') === 'true'} /></Suspense></RequireAuth>} />
      <Route path="/" element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard"                element={<Suspense fallback={<Fallback />}><DashboardPage /></Suspense>} />
        <Route path="opportunities"            element={<Suspense fallback={<Fallback />}><OpportunitiesPage /></Suspense>} />
        <Route path="opportunities/new"        element={<Suspense fallback={<Fallback />}><NewOpportunityPage /></Suspense>} />
        <Route path="opportunities/:id"        element={<Suspense fallback={<Fallback />}><OpportunityDetail /></Suspense>} />
        <Route path="opportunities/:id/generate" element={<Suspense fallback={<Fallback />}><GenerationPage /></Suspense>} />
        <Route path="opportunities/:id/orals"    element={<Suspense fallback={<Fallback />}><OralsPage /></Suspense>} />
        <Route path="knowledge-base"           element={<Suspense fallback={<Fallback />}><KnowledgeBasePage /></Suspense>} />
        <Route path="settings"                 element={<Suspense fallback={<Fallback />}><SettingsPage /></Suspense>} />
        <Route path="settings/users"           element={<Suspense fallback={<Fallback />}><UsersPage /></Suspense>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoot />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
