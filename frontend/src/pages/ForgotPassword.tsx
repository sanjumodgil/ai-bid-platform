import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Button, Input } from '../components/ui'

export function ForgotPasswordPage() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [result, setResult]   = useState<{ message: string; demo_token?: string } | null>(null)

  const handleSubmit = async () => {
    if (!email) { setError('Please enter your email.'); return }
    setLoading(true); setError('')
    try {
      const res = await api.post('/auth/forgot-password', { email })
      setResult(res.data)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Something went wrong. Please try again.')
    } finally {
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
          <h1 className="text-xl font-semibold text-ink-500">Reset your password</h1>
          <p className="text-sm text-smoke-500 mt-1">Enter your email to receive a reset token</p>
        </div>

        {result ? (
          <div className="card p-6 space-y-4">
            <div className="rounded-lg bg-go-light border border-go/20 p-3">
              <p className="text-xs text-go">{result.message}</p>
            </div>
            {result.demo_token && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-ink-500">Your reset token:</p>
                <div className="bg-sand-100 rounded-lg p-3 font-mono text-xs text-ink-500 break-all select-all border border-sand-300">
                  {result.demo_token}
                </div>
                <p className="text-xs text-smoke-500">Copy this token and use it on the next page.</p>
                <Link to={`/reset-password?token=${result.demo_token}`}>
                  <Button type="button" variant="primary" className="w-full mt-2">
                    Continue to reset password
                  </Button>
                </Link>
              </div>
            )}
            {!result.demo_token && (
              <Link to="/login" className="text-xs text-clay-500 hover:underline block text-center">
                Back to sign in
              </Link>
            )}
          </div>
        ) : (
          <div className="card p-6 space-y-4">
            <Input label="Email address" type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              placeholder="you@company.com" autoFocus />
            {error && <p className="text-xs text-nogo">{error}</p>}
            <Button type="button" variant="primary" loading={loading}
              onClick={handleSubmit} className="w-full">
              Send reset token
            </Button>
            <Link to="/login" className="text-xs text-clay-500 hover:underline block text-center">
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
