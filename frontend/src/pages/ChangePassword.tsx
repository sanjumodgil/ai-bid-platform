import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../app/App'
import { Button, Input } from '../components/ui'
import { ShieldIcon } from '../components/ui/icons'

export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [current, setCurrent]   = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')

  const handleSubmit = async () => {
    if (!current)  { setError('Please enter your current password.'); return }
    if (!password) { setError('Please enter a new password.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password === current)  { setError('New password must be different from current.'); return }
    setLoading(true); setError('')
    try {
      await api.post('/auth/change-password', {
        current_password: current,
        new_password: password
      })
      navigate('/dashboard', { replace: true })
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to change password. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-sand-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl gradient-clay mb-4">
            <ShieldIcon size={22} className="text-white" />
          </div>
          <h1 className="text-xl font-semibold text-ink-500">
            {forced ? 'Please set a new password' : 'Change password'}
          </h1>
          {forced && (
            <p className="text-sm text-smoke-500 mt-1">
              You must change your password before continuing.
            </p>
          )}
        </div>
        <div className="card p-6 space-y-4">
          <Input label="Current password" type="password" value={current}
            onChange={e => setCurrent(e.target.value)} autoFocus />
          <Input label="New password" type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            hint="Minimum 8 characters" />
          <Input label="Confirm new password" type="password" value={confirm}
            onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          {error && (
            <div className="rounded-lg bg-nogo/10 border border-nogo/20 p-2.5">
              <p className="text-xs text-nogo">{error}</p>
            </div>
          )}
          <Button type="button" variant="primary" loading={loading}
            onClick={handleSubmit} className="w-full">
            Change password
          </Button>
          {!forced && (
            <button onClick={() => navigate(-1)}
              className="text-xs text-clay-500 hover:underline block w-full text-center">
              Cancel
            </button>
          )}
          {forced && (
            <button onClick={() => { logout(); navigate('/login') }}
              className="text-xs text-smoke-400 hover:underline block w-full text-center">
              Sign out instead
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
