import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { oralsApi, opportunitiesApi } from '../lib/api'
import { API_BASE } from '../lib/api'
import { Spinner, Button } from '../components/ui'
import { cn, timeAgo, INDUSTRY_LABELS } from '../lib/utils'
import {
  ChevronRightIcon, ZapIcon, CheckCircle2Icon, AlertCircleIcon,
  PlusIcon, Trash2Icon, RefreshCwIcon, EditIcon, MessageSquareIcon,
  UsersIcon, ClockIcon, BarChart2Icon, BookOpenIcon, ArrowRightIcon,
  DownloadIcon
} from '../components/ui/icons'

// ── Readiness ring ────────────────────────────────────────────────
function ReadinessRing({ score }: { score: number | null }) {
  const s = score || 0
  const r = 22, circ = 2 * Math.PI * r
  const fill = (s / 100) * circ
  const colour = s >= 70 ? '#4CAF50' : s >= 40 ? '#FF9800' : '#C8A882'
  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <svg width="64" height="64" className="-rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e8e0d8" strokeWidth="5" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={colour} strokeWidth="5"
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }} />
      </svg>
      <span className="absolute text-sm font-bold text-ink-500">{Math.round(s)}%</span>
    </div>
  )
}

// ── Q category badge ──────────────────────────────────────────────
const CAT_COLOURS: Record<string, string> = {
  technical:   'bg-info/10 text-info',
  commercial:  'bg-caution/10 text-caution',
  governance:  'bg-clay-100 text-clay-600',
  risk:        'bg-nogo/10 text-nogo',
  team:        'bg-go-light text-go',
  general:     'bg-sand-200 text-smoke-600',
}
const DIFF_COLOURS: Record<string, string> = {
  easy:   'text-go', medium: 'text-caution', hard: 'text-nogo'
}

// ── Main Page ─────────────────────────────────────────────────────
export function OralsPage() {
  const { id: oppId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'setup'|'deck'|'qa'|'rehearse'|'deliver'>('setup')

  const { data: opp } = useQuery({
    queryKey: ['opportunity', oppId],
    queryFn: () => opportunitiesApi.get(oppId!).then(r => r.data),
    enabled: !!oppId,
  })
  const { data: oralData } = useQuery({
    queryKey: ['oral', oppId],
    queryFn: () => oralsApi.get(oppId!).then(r => r.data),
    enabled: !!oppId,
    refetchInterval: 30_000,
  })
  const oral = oralData?.oral

  const tabs = [
    { id: 'setup',    label: 'Setup',        icon: <ClockIcon size={14} />,          stage: 11 },
    { id: 'deck',     label: 'Presentation', icon: <BarChart2Icon size={14} />,      stage: 12 },
    { id: 'qa',       label: 'Q&A Coach',    icon: <MessageSquareIcon size={14} />,  stage: 13 },
    { id: 'rehearse', label: 'Rehearsals',   icon: <RefreshCwIcon size={14} />,      stage: 14 },
    { id: 'deliver',  label: 'Deliver',      icon: <CheckCircle2Icon size={14} />,   stage: 15 },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs text-smoke-400 mb-0.5">
            <button onClick={() => navigate(`/opportunities/${oppId}`)}
              className="hover:text-clay-500 transition-colors">{opp?.name}</button>
            <ChevronRightIcon size={10} className="inline mx-1" />
            <span className="text-ink-500 font-medium">Orals Track</span>
          </p>
          <h1 className="text-xl font-semibold text-ink-500">Oral Presentation</h1>
        </div>
        {oral && (
          <div className="flex items-center gap-3">
            <ReadinessRing score={oral.readiness_score} />
            <div className="text-right">
              <p className="text-xs text-smoke-500">Readiness</p>
              <p className={cn('text-sm font-semibold',
                (oral.readiness_score || 0) >= 70 ? 'text-go' : 'text-caution')}>
                {(oral.readiness_score || 0) >= 70 ? 'Ready' : 'Preparing'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Pipeline progress */}
      <div className="card p-4 mb-6 overflow-x-auto">
        <div className="flex items-center gap-1">
          {tabs.map((t, i) => (
            <React.Fragment key={t.id}>
              <button onClick={() => setActiveTab(t.id as any)}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 transition-colors',
                  activeTab === t.id ? 'bg-clay-400 text-white' : 'bg-sand-100 text-smoke-500 hover:bg-sand-200')}>
                <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">
                  {t.stage}
                </span>
                {t.label}
              </button>
              {i < tabs.length - 1 && <ChevronRightIcon size={12} className="text-sand-300 flex-shrink-0" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 mb-6 border-b border-sand-200">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id as any)}
            className={cn('flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px',
              activeTab === t.id ? 'border-clay-400 text-clay-600' : 'border-transparent text-smoke-500 hover:text-ink-500')}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'setup'    && <SetupTab    oppId={oppId!} oral={oral} opp={opp} qc={qc} />}
      {activeTab === 'deck'     && <DeckTab     oppId={oppId!} opp={opp} qc={qc} />}
      {activeTab === 'qa'       && <QATab       oppId={oppId!} opp={opp} qc={qc} />}
      {activeTab === 'rehearse' && <RehearsalTab oppId={oppId!} qc={qc} />}
      {activeTab === 'deliver'  && <DeliverTab  oppId={oppId!} oral={oral} opp={opp} qc={qc} navigate={navigate} />}
    </div>
  )
}

// ── Stage 11 — Setup Tab ──────────────────────────────────────────
function SetupTab({ oppId, oral, opp, qc }: any) {
  const [form, setForm] = useState({
    oral_date: oral?.oral_date?.slice(0, 16) || '',
    venue: oral?.venue || '',
    format: oral?.format || 'in_person',
    duration_minutes: oral?.duration_minutes?.toString() || '60',
    evaluator_names: oral?.evaluator_names || '',
    evaluator_count: oral?.evaluator_count?.toString() || '',
    presenter_names: oral?.presenter_names || '',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (oral) setForm({
      oral_date: oral.oral_date?.slice(0, 16) || '',
      venue: oral.venue || '',
      format: oral.format || 'in_person',
      duration_minutes: oral.duration_minutes?.toString() || '60',
      evaluator_names: oral.evaluator_names || '',
      evaluator_count: oral.evaluator_count?.toString() || '',
      presenter_names: oral.presenter_names || '',
    })
  }, [oral?.id])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(v => ({ ...v, [k]: e.target.value }))

  const handleSave = async () => {
    setSaving(true); setMsg('')
    try {
      const payload = {
        ...form,
        duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
        evaluator_count: form.evaluator_count ? parseInt(form.evaluator_count) : null,
      }
      if (oral) await oralsApi.update(oppId, payload)
      else await oralsApi.setup(oppId, payload)
      qc.invalidateQueries({ queryKey: ['oral', oppId] })
      setMsg('Oral session saved.')
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'Save failed.')
    } finally { setSaving(false) }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-ink-500">Oral presentation details</h3>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-smoke-500 mb-1">Presentation date & time</label>
            <input type="datetime-local" value={form.oral_date} onChange={f('oral_date')}
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-smoke-500 mb-1">Format</label>
            <select value={form.format} onChange={f('format')}
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none bg-white">
              <option value="in_person">In person</option>
              <option value="virtual">Virtual</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-smoke-500 mb-1">Duration (minutes)</label>
            <input type="number" value={form.duration_minutes} onChange={f('duration_minutes')}
              placeholder="60"
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-smoke-500 mb-1">Venue / platform</label>
            <input value={form.venue} onChange={f('venue')}
              placeholder="e.g. Client HQ, London / Microsoft Teams"
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-smoke-500 mb-1">Evaluator count</label>
            <input type="number" value={form.evaluator_count} onChange={f('evaluator_count')}
              placeholder="3"
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-smoke-500 mb-1">Evaluator names</label>
            <input value={form.evaluator_names} onChange={f('evaluator_names')}
              placeholder="e.g. Jane Smith, John Doe"
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-smoke-500 mb-1">Presenter team</label>
            <textarea value={form.presenter_names} onChange={f('presenter_names')}
              placeholder="Names of people presenting, e.g. Sarah Jones, Mike Chen"
              rows={2}
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none resize-none" />
          </div>
        </div>

        {msg && <p className={cn('text-xs', msg.includes('fail') ? 'text-nogo' : 'text-go')}>{msg}</p>}
        <Button variant="primary" onClick={handleSave} loading={saving}>Save details</Button>
      </div>

      {/* Summary card */}
      <div className="space-y-4">
        {oral ? (
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-ink-500">Summary</h3>
            {[
              ['Date', oral.oral_date ? new Date(oral.oral_date).toLocaleString() : '—'],
              ['Format', oral.format?.replace('_', ' ') || '—'],
              ['Venue', oral.venue || '—'],
              ['Duration', oral.duration_minutes ? `${oral.duration_minutes} minutes` : '—'],
              ['Evaluators', oral.evaluator_names || '—'],
              ['Presenting team', oral.presenter_names || '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-smoke-500">{k}</span>
                <span className="font-medium text-ink-500 text-right max-w-48 truncate">{v}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-8 text-center">
            <ClockIcon size={28} className="text-sand-300 mx-auto mb-3" />
            <p className="text-sm text-smoke-500">Fill in the details on the left to set up this oral.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Stage 12 — Deck Tab ───────────────────────────────────────────
function DeckTab({ oppId, opp, qc }: any) {
  const [generating, setGenerating] = useState(false)
  const [genLog, setGenLog]         = useState<string[]>([])
  const [editingSlide, setEditingSlide] = useState<any | null>(null)
  const [editNotes, setEditNotes]   = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const { data: slidesData, isLoading } = useQuery({
    queryKey: ['slides', oppId],
    queryFn: () => oralsApi.getSlides(oppId).then(r => r.data),
    enabled: !!oppId,
  })
  const slides: any[] = slidesData?.slides || []

  useEffect(() => { logRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [genLog])

  const handlePropose = async () => {
    await oralsApi.proposeSlides(oppId)
    qc.invalidateQueries({ queryKey: ['slides', oppId] })
  }

  const handleGenerateAll = () => {
    setGenerating(true); setGenLog([])
    const url = oralsApi.generateAllSlidesUrl(oppId)
    const es = new EventSource(url)
    es.onmessage = e => {
      try {
        const d = JSON.parse(e.data)
        if (d.event === 'start')      setGenLog(l => [...l, `Generating ${d.total} slides...`])
        if (d.event === 'generating') setGenLog(l => [...l, `Generating: ${d.title}`])
        if (d.event === 'slide_done') { setGenLog(l => [...l, `✓ ${d.title}`]); qc.invalidateQueries({ queryKey: ['slides', oppId] }) }
        if (d.event === 'complete')   { setGenerating(false); es.close(); setGenLog(l => [...l, `✅ Done — ${d.total} slides ready`]) }
      } catch {}
    }
    es.onerror = () => { setGenerating(false); es.close() }
  }

  const handleSaveNotes = async () => {
    if (!editingSlide) return
    await oralsApi.updateSlide(oppId, editingSlide.id, { speaker_notes: editNotes })
    qc.invalidateQueries({ queryKey: ['slides', oppId] })
    setEditingSlide(null)
  }

  const totalMins = slides.reduce((acc, s) => acc + (s.duration_minutes || 0), 0)
  const doneCount  = slides.filter(s => s.status !== 'pending').length

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        {/* Actions */}
        <div className="flex items-center gap-2">
          {slides.length === 0 ? (
            <Button variant="primary" onClick={handlePropose} icon={<ZapIcon size={14} />}>
              AI proposes slide structure
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={handleGenerateAll} loading={generating}
                icon={<ZapIcon size={14} />} disabled={doneCount === slides.length}>
                {doneCount === slides.length ? 'All talking points generated' : 'Generate all talking points'}
              </Button>
              <Button variant="secondary" onClick={handlePropose} icon={<PlusIcon size={14} />}>
                Add slide
              </Button>
              <a href={`${oralsApi.pptxUrl(oppId)}&token=${localStorage.getItem('bp_token')}`}
                 target="_blank" rel="noreferrer" className="ml-auto">
                <Button variant="secondary" icon={<DownloadIcon size={14} />}>
                  Export .pptx
                </Button>
              </a>
            </>
          )}
          {totalMins > 0 && (
            <span className="text-xs text-smoke-400 ml-auto">{totalMins} min total</span>
          )}
        </div>

        {/* Live log */}
        {generating && (
          <div className="card p-3 bg-ink-500 font-mono text-xs text-sand-200 h-28 overflow-y-auto space-y-0.5">
            {genLog.map((l, i) => <p key={i}>{l}</p>)}
            <div ref={logRef} />
          </div>
        )}

        {/* Slides */}
        {isLoading ? <Spinner /> : slides.length === 0 ? (
          <div className="card p-8 text-center">
            <BarChart2Icon size={28} className="text-sand-300 mx-auto mb-3" />
            <p className="text-sm text-smoke-500">Click "AI proposes slide structure" to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {slides.map((s: any, idx: number) => (
              <div key={s.id} className={cn('card p-4 transition-colors',
                editingSlide?.id === s.id && 'border-clay-200')}>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded bg-sand-100 flex items-center justify-center text-xs font-bold text-smoke-500 flex-shrink-0">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-ink-500">{s.title}</p>
                      {s.slide_type && (
                        <span className="text-xs bg-sand-100 text-smoke-500 px-1.5 py-0.5 rounded">{s.slide_type}</span>
                      )}
                      {s.duration_minutes && (
                        <span className="text-xs text-smoke-400">{s.duration_minutes}m</span>
                      )}
                      <span className={cn('text-xs ml-auto',
                        s.status === 'generated' || s.status === 'edited' ? 'text-go' : 'text-smoke-400')}>
                        {s.status === 'generated' ? '✓ Generated' : s.status === 'edited' ? '✓ Edited' : '○ Pending'}
                      </span>
                    </div>
                    {s.talking_points && (
                      <div className="text-xs text-smoke-600 leading-relaxed space-y-0.5 mt-1">
                        {s.talking_points.split('\n').slice(0, 4).map((l: string, i: number) => (
                          l.trim() && <p key={i}>{l}</p>
                        ))}
                      </div>
                    )}
                    {editingSlide?.id === s.id && (
                      <div className="mt-2 space-y-2">
                        <label className="text-xs text-smoke-500 font-medium">Speaker notes</label>
                        <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
                          rows={3} placeholder="Personal notes for the presenter..."
                          className="w-full text-xs border border-sand-300 rounded-lg px-2.5 py-1.5 focus:border-clay-400 focus:outline-none resize-none" />
                        <div className="flex gap-2">
                          <button onClick={handleSaveNotes}
                            className="px-3 py-1 bg-clay-400 text-white text-xs rounded-lg hover:bg-clay-500">Save</button>
                          <button onClick={() => setEditingSlide(null)}
                            className="px-3 py-1 bg-sand-200 text-smoke-600 text-xs rounded-lg hover:bg-sand-300">Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => { setEditingSlide(s); setEditNotes(s.speaker_notes || '') }}
                      className="p-1.5 text-smoke-400 hover:text-clay-500 transition-colors">
                      <EditIcon size={13} />
                    </button>
                    <button onClick={async () => { await oralsApi.deleteSlide(oppId, s.id); qc.invalidateQueries({ queryKey: ['slides', oppId] }) }}
                      className="p-1.5 text-smoke-400 hover:text-nogo transition-colors">
                      <Trash2Icon size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card p-5 space-y-4 h-fit">
        <h3 className="text-sm font-semibold text-ink-500">Deck summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-smoke-500">Total slides</span><span className="font-medium">{slides.length}</span></div>
          <div className="flex justify-between"><span className="text-smoke-500">Generated</span><span className="font-medium text-go">{doneCount}</span></div>
          <div className="flex justify-between"><span className="text-smoke-500">Total time</span><span className="font-medium">{totalMins} min</span></div>
        </div>
        <div>
          <p className="text-xs font-semibold text-smoke-500 uppercase tracking-wide mb-2">Slide types</p>
          {['cover','agenda','section','qa','close'].map(type => {
            const count = slides.filter(s => s.slide_type === type).length
            return count > 0 ? (
              <div key={type} className="flex justify-between text-xs py-0.5">
                <span className="text-smoke-400 capitalize">{type}</span>
                <span className="text-ink-500 font-medium">{count}</span>
              </div>
            ) : null
          })}
        </div>
      </div>
    </div>
  )
}

// ── Stage 13 — Q&A Tab ────────────────────────────────────────────
function QATab({ oppId, opp, qc }: any) {
  const [generating, setGenerating]   = useState(false)
  const [genLog, setGenLog]           = useState<string[]>([])
  const [qCount, setQCount]           = useState(20)
  const [showCountPicker, setShowCountPicker] = useState(false)
  const [filterCat, setFilterCat]     = useState('all')
  const [expandedQ, setExpandedQ]     = useState<string | null>(null)
  const [editingAnswer, setEditingAnswer] = useState<string | null>(null)
  const [answerText, setAnswerText]   = useState('')
  const [newQ, setNewQ]               = useState('')
  const [newCat, setNewCat]           = useState('general')
  const logRef = useRef<HTMLDivElement>(null)

  const { data: qData } = useQuery({
    queryKey: ['questions', oppId],
    queryFn: () => oralsApi.getQuestions(oppId).then(r => r.data),
    enabled: !!oppId,
    refetchInterval: generating ? 3000 : false,
  })
  const questions: any[] = qData?.questions || []
  const filtered = filterCat === 'all' ? questions : questions.filter(q => q.category === filterCat)
  const rehearsedCount = questions.filter(q => q.rehearsed).length

  useEffect(() => { logRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [genLog])

  const handleGenerate = () => {
    setShowCountPicker(false)
    setGenerating(true); setGenLog([])
    const url = oralsApi.generateQuestionsUrl(oppId, qCount)
    const es = new EventSource(url)
    es.onmessage = e => {
      try {
        const d = JSON.parse(e.data)
        if (d.event === 'start')             setGenLog(l => [...l, `Generating ${d.count} questions...`])
        if (d.event === 'generating_category') setGenLog(l => [...l, `Category: ${d.category}`])
        if (d.event === 'category_done')     { setGenLog(l => [...l, `✓ ${d.category}: ${d.added} questions`]); qc.invalidateQueries({ queryKey: ['questions', oppId] }) }
        if (d.event === 'complete')          { setGenerating(false); es.close(); setGenLog(l => [...l, `✅ Done — ${d.total} questions ready`]) }
        if (d.event === 'category_error')    setGenLog(l => [...l, `⚠ ${d.category}: ${d.error}`])
      } catch {}
    }
    es.onerror = () => { setGenerating(false); es.close() }
  }

  const handleAddManual = async () => {
    if (!newQ.trim()) return
    await oralsApi.addQuestion(oppId, { question: newQ, category: newCat })
    qc.invalidateQueries({ queryKey: ['questions', oppId] })
    setNewQ('')
  }

  const handleSaveAnswer = async (qId: string) => {
    await oralsApi.updateQuestion(oppId, qId, { edited_answer: answerText })
    qc.invalidateQueries({ queryKey: ['questions', oppId] })
    setEditingAnswer(null)
  }

  const handleToggleRehearsed = async (q: any) => {
    await oralsApi.updateQuestion(oppId, q.id, { rehearsed: !q.rehearsed })
    qc.invalidateQueries({ queryKey: ['questions', oppId] })
  }

  const categories = ['all', ...Array.from(new Set(questions.map(q => q.category).filter(Boolean)))]

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        {/* Generate / count picker */}
        {!showCountPicker && !generating && (
          <div className="flex items-center gap-2">
            {questions.length === 0 ? (
              <Button variant="primary" onClick={() => setShowCountPicker(true)}
                icon={<ZapIcon size={14} />}>Generate anticipated questions</Button>
            ) : (
              <Button variant="secondary" onClick={() => setShowCountPicker(true)}
                icon={<ZapIcon size={14} />}>Generate more questions</Button>
            )}
            <span className="text-xs text-smoke-400 ml-auto">
              {rehearsedCount}/{questions.length} rehearsed
            </span>
          </div>
        )}

        {/* Count picker — shown before generating */}
        {showCountPicker && (
          <div className="card p-4 border-clay-200 bg-clay-50/30 space-y-3">
            <h3 className="text-sm font-semibold text-ink-500">How many questions to generate?</h3>
            <div className="flex gap-2">
              {[10, 20, 30].map(n => (
                <button key={n} onClick={() => setQCount(n)}
                  className={cn('flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors',
                    qCount === n ? 'border-clay-400 bg-clay-400 text-white' : 'border-sand-300 bg-white text-smoke-600 hover:border-clay-200')}>
                  {n} questions
                  <p className="text-xs font-normal opacity-70 mt-0.5">
                    {n === 10 ? 'Focused, high-quality' : n === 20 ? 'Broad coverage' : 'Comprehensive'}
                  </p>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={handleGenerate} icon={<ZapIcon size={14} />}>
                Generate {qCount} questions
              </Button>
              <Button variant="ghost" onClick={() => setShowCountPicker(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Live log */}
        {generating && (
          <div className="card p-3 bg-ink-500 font-mono text-xs text-sand-200 h-28 overflow-y-auto space-y-0.5">
            {genLog.map((l, i) => <p key={i}>{l}</p>)}
            <div ref={logRef} />
          </div>
        )}

        {/* Category filter */}
        {questions.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {categories.map(cat => (
              <button key={cat} onClick={() => setFilterCat(cat)}
                className={cn('text-xs px-2.5 py-1 rounded-full font-medium transition-colors',
                  filterCat === cat ? 'bg-clay-400 text-white' : 'bg-sand-100 text-smoke-500 hover:bg-sand-200')}>
                {cat === 'all' ? `All (${questions.length})` : `${cat} (${questions.filter(q => q.category === cat).length})`}
              </button>
            ))}
          </div>
        )}

        {/* Question list */}
        {filtered.length === 0 && !generating ? (
          <div className="card p-8 text-center">
            <MessageSquareIcon size={28} className="text-sand-300 mx-auto mb-3" />
            <p className="text-sm text-smoke-500">No questions yet. Generate them above or add manually.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((q: any) => (
              <div key={q.id} className={cn('card p-4 transition-colors cursor-pointer',
                expandedQ === q.id && 'border-clay-200 bg-clay-50/20')}>
                <div className="flex items-start gap-3" onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)}>
                  <button onClick={e => { e.stopPropagation(); handleToggleRehearsed(q) }}
                    className={cn('w-5 h-5 rounded flex-shrink-0 border-2 flex items-center justify-center mt-0.5 transition-colors',
                      q.rehearsed ? 'bg-go border-go' : 'border-sand-300 hover:border-clay-400')}>
                    {q.rehearsed && <CheckCircle2Icon size={11} className="text-white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm font-medium', q.rehearsed ? 'text-smoke-400 line-through' : 'text-ink-500')}>
                      {q.question}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {q.category && (
                        <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', CAT_COLOURS[q.category] || 'bg-sand-200 text-smoke-500')}>
                          {q.category}
                        </span>
                      )}
                      {q.difficulty && (
                        <span className={cn('text-xs font-medium', DIFF_COLOURS[q.difficulty] || '')}>
                          {q.difficulty}
                        </span>
                      )}
                      {q.source === 'manual' && <span className="text-xs text-smoke-400">manual</span>}
                    </div>
                  </div>
                  <ChevronRightIcon size={14} className={cn('text-smoke-400 flex-shrink-0 transition-transform', expandedQ === q.id && 'rotate-90')} />
                </div>

                {expandedQ === q.id && (
                  <div className="mt-3 pl-8 space-y-3">
                    {editingAnswer === q.id ? (
                      <div className="space-y-2">
                        <label className="text-xs text-smoke-500 font-medium">Model answer</label>
                        <textarea value={answerText} onChange={e => setAnswerText(e.target.value)}
                          rows={4} className="w-full text-xs border border-sand-300 rounded-lg px-2.5 py-1.5 focus:border-clay-400 focus:outline-none resize-none" />
                        <div className="flex gap-2">
                          <button onClick={() => handleSaveAnswer(q.id)}
                            className="px-3 py-1 bg-clay-400 text-white text-xs rounded-lg hover:bg-clay-500">Save</button>
                          <button onClick={() => setEditingAnswer(null)}
                            className="px-3 py-1 bg-sand-200 text-smoke-600 text-xs rounded-lg">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-semibold text-smoke-500">Model answer</p>
                          <button onClick={() => { setEditingAnswer(q.id); setAnswerText(q.edited_answer || q.model_answer || '') }}
                            className="text-xs text-clay-500 hover:underline flex items-center gap-1">
                            <EditIcon size={11} /> Edit
                          </button>
                        </div>
                        <p className="text-xs text-smoke-600 leading-relaxed">
                          {q.edited_answer || q.model_answer || 'No answer drafted yet.'}
                        </p>
                      </div>
                    )}
                    <button onClick={async () => { await oralsApi.deleteQuestion(oppId, q.id); qc.invalidateQueries({ queryKey: ['questions', oppId] }) }}
                      className="text-xs text-smoke-400 hover:text-nogo transition-colors flex items-center gap-1">
                      <Trash2Icon size={11} /> Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add manual question */}
        <div className="card p-4 space-y-2">
          <p className="text-xs font-semibold text-smoke-500">Add question manually</p>
          <div className="flex gap-2">
            <input value={newQ} onChange={e => setNewQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddManual()}
              placeholder="Type a question you expect..."
              className="flex-1 text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
            <select value={newCat} onChange={e => setNewCat(e.target.value)}
              className="text-sm border border-sand-300 rounded-lg px-2 py-1.5 focus:border-clay-400 focus:outline-none bg-white">
              {['technical','commercial','governance','risk','team','general'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button onClick={handleAddManual}
              className="px-3 py-1.5 bg-clay-400 text-white text-xs rounded-lg hover:bg-clay-500">Add</button>
          </div>
        </div>
      </div>

      {/* Stats panel */}
      <div className="card p-5 h-fit space-y-4">
        <h3 className="text-sm font-semibold text-ink-500">Q&A readiness</h3>
        <div className="flex justify-center">
          <div className="text-center">
            <p className="text-3xl font-bold text-ink-500">{rehearsedCount}</p>
            <p className="text-xs text-smoke-500">of {questions.length} rehearsed</p>
          </div>
        </div>
        <div className="w-full h-2 bg-sand-200 rounded-full overflow-hidden">
          <div className="h-full bg-go rounded-full transition-all"
            style={{ width: `${questions.length ? (rehearsedCount / questions.length * 100) : 0}%` }} />
        </div>
        <div className="space-y-1.5 text-xs">
          {['technical','commercial','governance','risk','team','general'].map(cat => {
            const total = questions.filter(q => q.category === cat).length
            if (!total) return null
            const done  = questions.filter(q => q.category === cat && q.rehearsed).length
            return (
              <div key={cat} className="flex items-center gap-2">
                <span className={cn('px-1.5 py-0.5 rounded-full font-medium text-xs', CAT_COLOURS[cat] || '')}>{cat}</span>
                <div className="flex-1 h-1 bg-sand-200 rounded-full overflow-hidden">
                  <div className="h-full bg-clay-400 rounded-full" style={{ width: `${(done/total)*100}%` }} />
                </div>
                <span className="text-smoke-400">{done}/{total}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Stage 14 — Rehearsal Tab ──────────────────────────────────────
function RehearsalTab({ oppId, qc }: any) {
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState({
    rehearsal_date: '', duration_minutes: '60', attendee_names: '',
    facilitator_name: '', strengths: '', improvements: '', feedback: '', readiness_rating: '3'
  })
  const [saving, setSaving]         = useState(false)

  const { data: rData } = useQuery({
    queryKey: ['rehearsals', oppId],
    queryFn: () => oralsApi.getRehearsals(oppId).then(r => r.data),
    enabled: !!oppId,
  })
  const rehearsals: any[] = rData?.rehearsals || []

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(v => ({ ...v, [k]: e.target.value }))

  const handleAdd = async () => {
    setSaving(true)
    try {
      await oralsApi.addRehearsal(oppId, {
        ...form,
        duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
        readiness_rating: form.readiness_rating ? parseInt(form.readiness_rating) : null,
      })
      qc.invalidateQueries({ queryKey: ['rehearsals', oppId] })
      qc.invalidateQueries({ queryKey: ['oral', oppId] })
      setShowForm(false)
      setForm({ rehearsal_date: '', duration_minutes: '60', attendee_names: '', facilitator_name: '', strengths: '', improvements: '', feedback: '', readiness_rating: '3' })
    } finally { setSaving(false) }
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink-500">{rehearsals.length} rehearsal{rehearsals.length !== 1 ? 's' : ''} logged</h3>
          <Button variant="primary" onClick={() => setShowForm(!showForm)} icon={<PlusIcon size={14} />}>
            Log rehearsal
          </Button>
        </div>

        {showForm && (
          <div className="card p-5 space-y-3 border-clay-200">
            <h3 className="text-sm font-semibold text-ink-500">New rehearsal session</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-smoke-500 mb-1">Date</label>
                <input type="datetime-local" value={form.rehearsal_date} onChange={f('rehearsal_date')}
                  className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-smoke-500 mb-1">Duration (min)</label>
                <input type="number" value={form.duration_minutes} onChange={f('duration_minutes')}
                  className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-smoke-500 mb-1">Attendees</label>
                <input value={form.attendee_names} onChange={f('attendee_names')} placeholder="Comma separated names"
                  className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-smoke-500 mb-1">Facilitator</label>
                <input value={form.facilitator_name} onChange={f('facilitator_name')}
                  className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-smoke-500 mb-1">Readiness rating (1-5)</label>
                <select value={form.readiness_rating} onChange={f('readiness_rating')}
                  className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none bg-white">
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} {'★'.repeat(n)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">What went well</label>
              <textarea value={form.strengths} onChange={f('strengths')} rows={2}
                className="w-full text-xs border border-sand-300 rounded-lg px-2.5 py-1.5 focus:border-clay-400 focus:outline-none resize-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Areas to improve</label>
              <textarea value={form.improvements} onChange={f('improvements')} rows={2}
                className="w-full text-xs border border-sand-300 rounded-lg px-2.5 py-1.5 focus:border-clay-400 focus:outline-none resize-none" />
            </div>
            <div className="flex gap-2">
              <Button variant="primary" onClick={handleAdd} loading={saving}>Save rehearsal</Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {rehearsals.length === 0 ? (
          <div className="card p-8 text-center">
            <RefreshCwIcon size={28} className="text-sand-300 mx-auto mb-3" />
            <p className="text-sm text-smoke-500">No rehearsals logged yet. Log your first session above.</p>
          </div>
        ) : (
          rehearsals.map((r: any) => (
            <div key={r.id} className="card p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm font-medium text-ink-500">
                    {new Date(r.rehearsal_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                    {r.duration_minutes && ` · ${r.duration_minutes} min`}
                  </p>
                  <p className="text-xs text-smoke-500 mt-0.5">
                    {r.attendee_names && `Attendees: ${r.attendee_names}`}
                    {r.facilitator_name && ` · Facilitated by ${r.facilitator_name}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.readiness_rating && (
                    <span className="text-sm text-caution">{'★'.repeat(r.readiness_rating)}</span>
                  )}
                  <button onClick={async () => { await oralsApi.deleteRehearsal(oppId, r.id); qc.invalidateQueries({ queryKey: ['rehearsals', oppId] }) }}
                    className="text-smoke-300 hover:text-nogo transition-colors">
                    <Trash2Icon size={13} />
                  </button>
                </div>
              </div>
              {r.strengths && <p className="text-xs text-smoke-600 mt-1"><span className="text-go font-medium">✓ </span>{r.strengths}</p>}
              {r.improvements && <p className="text-xs text-smoke-600 mt-0.5"><span className="text-nogo font-medium">→ </span>{r.improvements}</p>}
            </div>
          ))
        )}
      </div>

      <div className="card p-5 h-fit space-y-3">
        <h3 className="text-sm font-semibold text-ink-500">Rehearsal progress</h3>
        <div className="text-center">
          <p className="text-3xl font-bold text-ink-500">{rehearsals.length}</p>
          <p className="text-xs text-smoke-500">sessions completed</p>
        </div>
        {rehearsals.length > 0 && (
          <div>
            <p className="text-xs text-smoke-500 mb-1">Average rating</p>
            <p className="text-sm font-semibold text-caution">
              {'★'.repeat(Math.round(rehearsals.reduce((a, r) => a + (r.readiness_rating || 0), 0) / rehearsals.length))}
            </p>
          </div>
        )}
        <p className="text-xs text-smoke-400">
          Aim for at least 3 rehearsals before the oral. Each session increases your readiness score.
        </p>
      </div>
    </div>
  )
}

// ── Stage 15 — Deliver Tab ────────────────────────────────────────
function DeliverTab({ oppId, oral, opp, qc, navigate }: any) {
  const [result, setResult]       = useState(oral?.result || '')
  const [notes, setNotes]         = useState(oral?.delivery_notes || '')
  const [feedback, setFeedback]   = useState(oral?.evaluator_feedback || '')
  const [resultNotes, setResultNotes] = useState(oral?.result_notes || '')
  const [saving, setSaving]       = useState(false)
  const [captured, setCaptured]   = useState<any>(null)
  const [msg, setMsg]             = useState('')

  const handleCapture = async () => {
    if (!result) { setMsg('Please select a result.'); return }
    setSaving(true); setMsg('')
    try {
      const res = await oralsApi.captureResult(oppId, {
        result, delivery_notes: notes,
        result_notes: resultNotes, evaluator_feedback: feedback
      })
      setCaptured(res.data)
      qc.invalidateQueries({ queryKey: ['oral', oppId] })
      qc.invalidateQueries({ queryKey: ['opportunity', oppId] })
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'Failed to capture result.')
    } finally { setSaving(false) }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-500">Stage 15 — Oral delivery result</h3>
          <p className="text-xs text-smoke-500 mt-0.5">Record the outcome of the oral presentation.</p>
        </div>

        {oral?.result && !captured && (
          <div className={cn('rounded-lg p-3 border',
            oral.result === 'won_at_orals' ? 'bg-go-light border-go/20' : 'bg-nogo/5 border-nogo/20')}>
            <p className={cn('text-sm font-semibold',
              oral.result === 'won_at_orals' ? 'text-go' : 'text-nogo')}>
              {oral.result === 'won_at_orals' ? '🏆 Won at orals' : '❌ Lost at orals'}
            </p>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-smoke-500 mb-1">Result</label>
            <select value={result} onChange={e => setResult(e.target.value)}
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none bg-white">
              <option value="">Select result</option>
              <option value="won_at_orals">Won at orals 🏆</option>
              <option value="lost_at_orals">Lost at orals</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-smoke-500 mb-1">Delivery notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="How did the presentation go? Key moments..."
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-smoke-500 mb-1">Evaluator feedback</label>
            <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={3}
              placeholder="Any verbal or written feedback from evaluators..."
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-smoke-500 mb-1">Result notes</label>
            <textarea value={resultNotes} onChange={e => setResultNotes(e.target.value)} rows={2}
              placeholder="Context around the result..."
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none resize-none" />
          </div>
          {msg && <p className="text-xs text-nogo">{msg}</p>}
          <Button variant="primary" onClick={handleCapture} loading={saving} className="w-full">
            Capture oral result
          </Button>
        </div>
      </div>

      {/* Stage 16 KB loop */}
      <div className="space-y-4">
        {captured && (
          <>
            <div className={cn('card p-5 border-2',
              captured.oral?.result === 'won_at_orals' ? 'border-go bg-go-light' : 'border-sand-200')}>
              <p className={cn('text-lg font-bold mb-1',
                captured.oral?.result === 'won_at_orals' ? 'text-go' : 'text-ink-500')}>
                {captured.oral?.result === 'won_at_orals' ? '🏆 Congratulations!' : 'Result captured'}
              </p>
              <p className="text-sm text-smoke-600">{captured.message}</p>
            </div>

            <div className="card p-5 space-y-3 bg-clay-50 border-clay-100">
              <p className="text-sm font-semibold text-clay-700">Stage 16 — KB Learning Loop</p>
              <p className="text-xs text-clay-600">
                Close the loop — add this bid to the Knowledge Base so the team can learn from it.
              </p>
              <div className="space-y-2">
                <a href={`/knowledge-base`}
                  className="flex items-center justify-between p-3 rounded-lg bg-white border border-clay-200 hover:bg-clay-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <BookOpenIcon size={14} className="text-clay-500" />
                    <span className="text-sm font-medium text-clay-700">Promote bid documents to KB</span>
                  </div>
                  <ArrowRightIcon size={14} className="text-clay-400" />
                </a>
                <button
                  onClick={() => navigate(`/knowledge-base`)}
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-white border border-clay-200 hover:bg-clay-50 transition-colors">
                  <div className="flex items-center gap-2">
                    <MessageSquareIcon size={14} className="text-clay-500" />
                    <span className="text-sm font-medium text-clay-700">Add lessons learned</span>
                  </div>
                  <ArrowRightIcon size={14} className="text-clay-400" />
                </button>
              </div>
              {captured.prefilled_lesson && (
                <div className="rounded-lg bg-white border border-clay-100 p-3">
                  <p className="text-xs text-smoke-500 font-medium mb-1">Pre-filled lesson draft ready:</p>
                  <p className="text-xs text-smoke-600">
                    Outcome: <strong>{captured.prefilled_lesson.bid_outcome}</strong>
                    {captured.prefilled_lesson.evaluator_feedback && ` · Feedback captured`}
                    {' · Flagged for attention ✓'}
                  </p>
                </div>
              )}
            </div>
          </>
        )}

        {!captured && (
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-ink-500">Readiness check</h3>
            {oral?.readiness_score !== null ? (
              <div className="flex items-center gap-4">
                <ReadinessRing score={oral?.readiness_score} />
                <div>
                  <p className={cn('text-sm font-semibold',
                    (oral?.readiness_score || 0) >= 70 ? 'text-go' : 'text-caution')}>
                    {(oral?.readiness_score || 0) >= 70 ? 'Ready to present' : 'Still preparing'}
                  </p>
                  <p className="text-xs text-smoke-500 mt-0.5">
                    Complete slides, rehearse Q&A, and run practice sessions to improve.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-smoke-500">Set up slides and rehearsals to see your readiness score.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
