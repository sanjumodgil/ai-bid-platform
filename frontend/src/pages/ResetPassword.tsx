import React, { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Button, Input } from '../components/ui'
import { CheckCircle2Icon } from '../components/ui/icons'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [token, setToken]       = useState(params.get('token') || '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [done, setDone]         = useState(false)

  const handleSubmit = async () => {
    if (!token)    { setError('Reset token is required.'); return }
    if (!password) { setError('Please enter a new password.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true); setError('')
    try {
      await api.post('/auth/reset-password', { token, new_password: password })
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Reset failed. The token may have expired.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="min-h-screen bg-sand-100 flex items-center justify-center p-6">
        <div className="card p-8 max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-full bg-go-light flex items-center justify-center mx-auto mb-4">
            <CheckCircle2Icon size={24} className="text-go" />
          </div>
          <h2 className="text-base font-semibold text-ink-500 mb-2">Password reset successfully</h2>
          <p className="text-xs text-smoke-500">Redirecting to sign in...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-sand-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl gradient-clay mb-4">
            <span className="text-white text-xl font-bold">B</span>
          </div>
          <h1 className="text-xl font-semibold text-ink-500">Set new password</h1>
          <p className="text-sm text-smoke-500 mt-1">Enter your reset token and a new password</p>
        </div>
        <div className="card p-6 space-y-4">
          {!params.get('token') && (
            <Input label="Reset token" value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="Paste your reset token here" />
          )}
          <Input label="New password" type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            hint="Minimum 8 characters" />
          <Input label="Confirm password" type="password" value={confirm}
            onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          {error && (
            <div className="rounded-lg bg-nogo/10 border border-nogo/20 p-2.5">
              <p className="text-xs text-nogo">{error}</p>
            </div>
          )}
          <Button type="button" variant="primary" loading={loading}
            onClick={handleSubmit} className="w-full">
            Reset password
          </Button>
          <Link to="/login" className="text-xs text-clay-500 hover:underline block text-center">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
