import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setupApi } from '../lib/api'
import { Button, Input, Select } from '../components/ui'
import { CheckCircle2Icon, ChevronRightIcon, ChevronLeftIcon, ZapIcon, DatabaseIcon, ShieldIcon, UserIcon } from '../components/ui/icons'
import { cn } from '../lib/utils'

const STEPS = [
  { id: 1, title: 'Platform',   description: 'Name and appearance',     icon: <ZapIcon size={18} /> },
  { id: 2, title: 'Admin',      description: 'Superuser account',        icon: <UserIcon size={18} /> },
  { id: 3, title: 'AI Model',   description: 'LLM provider (optional)',  icon: <ZapIcon size={18} /> },
  { id: 4, title: 'Storage',    description: 'Vector database',          icon: <DatabaseIcon size={18} /> },
]

const LLM_PROVIDERS = [
  { value: '', label: 'Skip for now — configure later' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic Claude' },
  { value: 'azure_openai', label: 'Azure OpenAI' },
  { value: 'google', label: 'Google Gemini' },
  { value: 'mistral', label: 'Mistral AI' },
  { value: 'ollama', label: 'Ollama (local/air-gapped)' },
]

const LLM_MODELS: Record<string, Array<{value: string; label: string}>> = {
  openai:       [{ value: 'gpt-4o', label: 'GPT-4o' }, { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' }],
  anthropic:    [{ value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' }],
  azure_openai: [{ value: 'gpt-4o', label: 'GPT-4o (Azure)' }],
  google:       [{ value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }],
  mistral:      [{ value: 'mistral-large-latest', label: 'Mistral Large' }],
  ollama:       [{ value: 'llama3.1:8b', label: 'LLaMA 3.1 8B' }],
}

const VECTOR_DBS = [
  { value: 'chroma',          label: 'ChromaDB — free, auto-provisioned (recommended)' },
  { value: 'qdrant',          label: 'Qdrant (self-hosted)' },
  { value: 'weaviate',        label: 'Weaviate (self-hosted)' },
  { value: 'pinecone',        label: 'Pinecone (managed cloud)' },
  { value: 'pgvector',        label: 'pgvector (PostgreSQL)' },
  { value: 'azure_ai_search', label: 'Azure AI Search (Enterprise)' },
]

// ── Simple state-based form (no react-hook-form / Zod in wizard) ──
interface FormValues {
  platform_name:    string
  accent_color:     string
  admin_name:       string
  admin_email:      string
  admin_password:   string
  llm_provider:     string
  llm_model:        string
  llm_api_key:      string
  llm_endpoint:     string
  vector_db_backend:string
  vector_db_url:    string
}

export default function FirstRunPage() {
  const navigate = useNavigate()
  const [step, setStep]       = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const [form, setForm] = useState<FormValues>({
    platform_name:     'AI-Powered Bid Platform',
    accent_color:      '#C8A882',
    admin_name:        '',
    admin_email:       '',
    admin_password:    '',
    llm_provider:      '',
    llm_model:         '',
    llm_api_key:       '',
    llm_endpoint:      '',
    vector_db_backend: 'chroma',
    vector_db_url:     '',
  })

  const set = (key: keyof FormValues) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => setForm(f => ({ ...f, [key]: e.target.value }))

  // ── Per-step validation ─────────────────────────────────────────
  const validateStep = (): string => {
    if (step === 1) {
      if (!form.platform_name.trim()) return 'Platform name is required.'
    }
    if (step === 2) {
      if (!form.admin_name.trim())   return 'Full name is required.'
      if (!form.admin_email.trim())  return 'Email address is required.'
      if (!/\S+@\S+\.\S+/.test(form.admin_email)) return 'Enter a valid email address.'
      if (!form.admin_password)      return 'Password is required.'
      if (form.admin_password.length < 8)  return 'Password must be at least 8 characters.'
      if (form.admin_password.length > 72) return 'Password must be 72 characters or fewer.'
    }
    return ''
  }

  const handleNext = () => {
    const err = validateStep()
    if (err) { setError(err); return }
    setError('')
    setStep(s => s + 1)
  }

  const handleBack = () => { setError(''); setStep(s => s - 1) }

  // ── Final submit ────────────────────────────────────────────────
  const handleSubmit = async () => {
    console.log('=== Complete Setup clicked ===')
    console.log('Form values:', JSON.stringify(form, null, 2))
    console.log('API_BASE will be:', import.meta.env.VITE_API_URL || 'http://localhost:8010')

    setLoading(true)
    setError('')

    try {
      const payload = {
        platform_name:     form.platform_name,
        accent_color:      form.accent_color,
        admin_name:        form.admin_name,
        admin_email:       form.admin_email,
        admin_password:    form.admin_password,
        llm_provider:      form.llm_provider   || undefined,
        llm_model:         form.llm_model       || undefined,
        llm_api_key:       form.llm_api_key     || undefined,
        llm_endpoint:      form.llm_endpoint    || undefined,
        vector_db_backend: form.vector_db_backend,
        vector_db_url:     form.vector_db_url   || undefined,
      }
      console.log('Sending payload:', payload)

      const res = await setupApi.firstRun(payload)
      console.log('Response:', res.status, res.data)

      if (res.data?.already_configured) {
        window.location.href = '/login'
        return
      }
      // Full page reload so App.tsx re-checks setup status from scratch
      window.location.href = '/login?setup=complete'

    } catch (e: any) {
      console.error('Setup error:', e)
      console.error('Response status:', e?.response?.status)
      console.error('Response data:', e?.response?.data)
      console.error('Message:', e?.message)

      const detail = e?.response?.data?.detail
      if (Array.isArray(detail)) {
        setError(detail.map((d: any) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join(', '))
      } else if (typeof detail === 'string') {
        setError(detail)
      } else if (e?.response?.status) {
        setError(`Server error ${e.response.status}: ${JSON.stringify(e?.response?.data)}`)
      } else if (e?.message) {
        setError(`Request failed: ${e.message}`)
      } else {
        setError('Setup failed — check browser console (F12) for details.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-sand-100 flex">
      {/* Left panel */}
      <div className="hidden lg:flex flex-col w-72 bg-white border-r border-sand-200 p-8">
        <div className="flex items-center gap-3 mb-12">
          <div className="w-8 h-8 rounded-xl gradient-clay flex items-center justify-center">
            <span className="text-white text-sm font-bold">B</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-500">AI-Powered</p>
            <p className="text-xs text-smoke-500">Bid Platform</p>
          </div>
        </div>
        <div className="space-y-1">
          {STEPS.map(s => (
            <div key={s.id} className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all',
              step === s.id ? 'bg-clay-50' : step > s.id ? 'opacity-70' : 'opacity-40'
            )}>
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
                step > s.id ? 'bg-go text-white' : step === s.id ? 'bg-clay-400 text-white' : 'bg-sand-200 text-smoke-400'
              )}>
                {step > s.id ? <CheckCircle2Icon size={14} /> : <span className="text-xs font-semibold">{s.id}</span>}
              </div>
              <div>
                <p className="text-sm font-medium text-ink-500">{s.title}</p>
                <p className="text-xs text-smoke-500">{s.description}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-auto pt-8">
          <p className="text-xs text-smoke-500 leading-relaxed">
            This wizard runs once. All settings can be changed in the admin panel after setup.
          </p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-lg">
          <div className="mb-8">
            <p className="text-xs font-semibold text-smoke-400 uppercase tracking-wider mb-1">Step {step} of {STEPS.length}</p>
            <h1 className="text-2xl font-semibold text-ink-500">{STEPS[step - 1].title}</h1>
            <p className="text-sm text-smoke-500 mt-1">{STEPS[step - 1].description}</p>
          </div>

          <div className="card p-6 space-y-4 animate-slide-up">

            {/* Step 1 — Platform */}
            {step === 1 && (
              <>
                <Input label="Platform name" value={form.platform_name} onChange={set('platform_name')} placeholder="AI-Powered Bid Platform" autoFocus />
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-ink-500">Accent colour</label>
                  <div className="flex items-center gap-3">
                    <input type="color" value={form.accent_color} onChange={set('accent_color')}
                      className="w-10 h-10 rounded-lg border border-sand-300 cursor-pointer p-0.5 bg-white" />
                    <div className="flex gap-2">
                      {['#C8A882','#7B9E87','#8B9DC3','#C47F6B','#9B89B4'].map(c => (
                        <button key={c} type="button"
                          className="w-7 h-7 rounded-full border-2 border-white shadow-warm-sm hover:scale-110 transition-transform"
                          style={{ background: c }}
                          onClick={() => setForm(f => ({ ...f, accent_color: c }))}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Step 2 — Admin */}
            {step === 2 && (
              <>
                <Input label="Full name" value={form.admin_name} onChange={set('admin_name')} placeholder="Jane Smith" autoFocus />
                <Input label="Email address" type="email" value={form.admin_email} onChange={set('admin_email')} placeholder="admin@yourcompany.com" />
                <Input label="Password" type="password" value={form.admin_password} onChange={set('admin_password')} hint="Minimum 8 characters, maximum 72" />
                <div className="rounded-lg bg-sand-100 border border-sand-200 p-3">
                  <p className="text-xs text-smoke-500 flex items-start gap-2">
                    <span className="flex-shrink-0 mt-0.5"><ShieldIcon size={13} /></span>
                    This account will have full Super Admin access. Store the password securely.
                  </p>
                </div>
              </>
            )}

            {/* Step 3 — LLM */}
            {step === 3 && (
              <>
                <Select label="LLM provider" value={form.llm_provider} onChange={set('llm_provider')} options={LLM_PROVIDERS} />
                {form.llm_provider && (
                  <>
                    <Select label="Model" value={form.llm_model} onChange={set('llm_model')}
                      options={LLM_MODELS[form.llm_provider] || [{ value: '', label: 'Select model' }]} />
                    {form.llm_provider !== 'ollama' && (
                      <Input label="API key" type="password" value={form.llm_api_key} onChange={set('llm_api_key')} placeholder="sk-..." />
                    )}
                    {(form.llm_provider === 'azure_openai' || form.llm_provider === 'ollama') && (
                      <Input label="Endpoint URL" value={form.llm_endpoint} onChange={set('llm_endpoint')} placeholder="https://..." />
                    )}
                  </>
                )}
                {!form.llm_provider && (
                  <div className="rounded-lg bg-sand-200 p-3">
                    <p className="text-xs text-smoke-500">You can skip this and add an LLM provider later in Settings → AI Configuration.</p>
                  </div>
                )}
              </>
            )}

            {/* Step 4 — Storage */}
            {step === 4 && (
              <>
                <Select label="Vector database" value={form.vector_db_backend} onChange={set('vector_db_backend')} options={VECTOR_DBS} />
                {form.vector_db_backend !== 'chroma' && (
                  <Input label="Connection URL" value={form.vector_db_url} onChange={set('vector_db_url')} placeholder="http://localhost:6333" />
                )}
                {form.vector_db_backend === 'chroma' && (
                  <div className="rounded-lg bg-go-light border border-go/20 p-3">
                    <p className="text-xs text-go flex items-start gap-2">
                      <span className="flex-shrink-0 mt-0.5"><CheckCircle2Icon size={13} /></span>
                      ChromaDB will be automatically provisioned. No additional setup required.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="mt-3 rounded-lg bg-nogo/10 border border-nogo/20 p-3">
              <p className="text-xs text-nogo">{error}</p>
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between mt-6">
            <Button type="button" variant="ghost" icon={<ChevronLeftIcon size={15} />}
              onClick={handleBack} disabled={step === 1}>
              Back
            </Button>

            {step < 4 ? (
              <Button type="button" variant="primary" onClick={handleNext}>
                Continue <ChevronRightIcon size={15} />
              </Button>
            ) : (
              <Button type="button" variant="primary" loading={loading} onClick={handleSubmit}>
                Complete setup
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
