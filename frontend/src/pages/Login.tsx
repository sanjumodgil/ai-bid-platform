import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { authApi } from '../lib/api'
import { useAuth } from '../app/App'
import { Button, Input } from '../components/ui'
import { CheckCircle2Icon } from '../components/ui/icons'

export function LoginPage() {
  const { login }   = useAuth()
  const navigate    = useNavigate()
  const [params]    = useSearchParams()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [authConfig, setAuthConfig] = useState<any>(null)
  const justSetup = params.get('setup') === 'complete'

  useEffect(() => {
    authApi.getAuthConfig().then(r => setAuthConfig(r.data)).catch(() => {})
  }, [])

  const handleAzureAD = async () => {
    try {
      const res = await authApi.getAzureAdLoginUrl(window.location.origin + '/auth/callback')
      window.location.href = res.data.login_url
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Azure AD login failed.')
    }
  }

  const handleLogin = async () => {
    if (!email || !password) { setError('Please enter your email and password.'); return }
    setLoading(true)
    setError('')
    try {
      const loginRes = await authApi.login(email, password)
      const token = loginRes.data?.access_token
      if (!token) { setError('No token received.'); setLoading(false); return }

      // Pass token directly — interceptor hasn't stored it yet at this point
      const meRes = await authApi.me(token)
      const user  = meRes.data

      // login() sets React context state AND writes to localStorage
      // navigate() then works because context is already updated
      login(token, loginRes.data.refresh_token || '', user)

      if (loginRes.data.must_change_password) {
        navigate('/change-password?forced=true', { replace: true })
      } else {
        navigate('/dashboard', { replace: true })
      }

    } catch (e: any) {
      const detail = e?.response?.data?.detail
      const status = e?.response?.status
      if (typeof detail === 'string') setError(detail)
      else if (status === 401) setError('Incorrect email or password.')
      else if (status === 422) setError('Invalid request format.')
      else setError(`Error: ${e?.message || 'Please try again.'}`)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-sand-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl gradient-clay mb-4">
            <span className="text-white text-xl font-bold">B</span>
          </div>
          <h1 className="text-2xl font-semibold text-ink-500">AI-Powered Bid Platform</h1>
          <p className="text-sm text-clay-500 mt-1.5 font-medium tracking-wide italic">
            "Every bid you win teaches the next one how."
          </p>
          <p className="text-xs text-smoke-400 mt-2">Sign in to your workspace</p>
        </div>

        {justSetup && (
          <div className="mb-4 rounded-xl bg-go-light border border-go/20 p-3 flex items-center gap-2">
            <CheckCircle2Icon size={15} className="text-go flex-shrink-0" />
            <p className="text-xs text-go">Setup complete. Sign in with your admin account.</p>
          </div>
        )}

        <div className="card p-6">
          <div className="space-y-4">
            {/* Azure AD SSO button — shown when configured */}
            {authConfig?.azure_ad_enabled && (
              <>
                <button onClick={handleAzureAD}
                  className="w-full flex items-center justify-center gap-2.5 px-4 py-2.5 border-2 border-sand-300 rounded-xl text-sm font-medium text-ink-500 hover:bg-sand-100 hover:border-clay-300 transition-all">
                  <svg width="18" height="18" viewBox="0 0 21 21" fill="none">
                    <rect x="1" y="1" width="9" height="9" fill="#F35325"/>
                    <rect x="11" y="1" width="9" height="9" fill="#81BC06"/>
                    <rect x="1" y="11" width="9" height="9" fill="#05A6F0"/>
                    <rect x="11" y="11" width="9" height="9" fill="#FFBA08"/>
                  </svg>
                  {authConfig.sso_label || 'Sign in with Microsoft'}
                </button>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-px bg-sand-200" />
                  <span className="text-xs text-smoke-400">or sign in with password</span>
                  <div className="flex-1 h-px bg-sand-200" />
                </div>
              </>
            )}
            <Input label="Email" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="you@company.com" autoFocus />
            <Input label="Password" type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••" />
            {error && (
              <div className="rounded-lg bg-nogo/10 border border-nogo/20 p-2.5">
                <p className="text-xs text-nogo">{error}</p>
              </div>
            )}
            <Button type="button" variant="primary" loading={loading}
              onClick={handleLogin} className="w-full">
              Sign in
            </Button>
            <Link to="/forgot-password" className="text-xs text-clay-500 hover:underline block text-center">
              Forgot your password?
            </Link>
          </div>
        </div>
        <p className="text-center text-xs text-smoke-400 mt-6">
          AI-Powered Bid Platform · v1.0
        </p>
      </div>
    </div>
  )
}

// ── Azure AD callback handler ────────────────────────────────────
export function AzureAdCallbackPage() {
  const { login }  = useAuth()
  const navigate   = useNavigate()
  const [params]   = useSearchParams()
  const [error, setError] = useState('')

  useEffect(() => {
    const code = params.get('code')
    if (!code) { setError('No authorisation code received.'); return }

    authApi.azureAdCallback(code, window.location.origin + '/auth/callback')
      .then(res => {
        const { access_token, user } = res.data
        login(access_token, '', {
          id: user.id, email: user.email, full_name: user.full_name, role: user.role,
          is_active: true,
          avatar_initials: (user.full_name || user.email || '').slice(0, 2).toUpperCase(),
        })
        navigate('/dashboard')
      })
      .catch(e => setError(e?.response?.data?.detail || 'Authentication failed.'))
  }, [])

  if (error) return (
    <div className="min-h-screen bg-sand-100 flex items-center justify-center p-6">
      <div className="card p-6 max-w-sm w-full text-center space-y-3">
        <p className="text-sm font-semibold text-nogo">Sign-in failed</p>
        <p className="text-xs text-smoke-500">{error}</p>
        <button onClick={() => navigate('/login')} className="text-xs text-clay-500 hover:underline">
          Back to login
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-sand-100 flex items-center justify-center">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-clay-400 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-smoke-500">Signing in with Microsoft…</p>
      </div>
    </div>
  )
}
