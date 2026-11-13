import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { generationApi, reviewApi, complianceApi, exportApi, submissionApi, opportunitiesApi, kbApi } from '../lib/api'
import { API_BASE, BASE } from '../lib/api'
import { Spinner, Button } from '../components/ui'
import { cn, timeAgo } from '../lib/utils'
import {
  ZapIcon, CheckCircle2Icon, AlertCircleIcon, RefreshCwIcon,
  DownloadIcon, ClipboardCheckIcon, MessageSquareIcon, UserIcon,
  ChevronRightIcon, PlusIcon, EditIcon, ArrowRightIcon, Trash2Icon,
  BookOpenIcon, ShieldIcon
} from '../components/ui/icons'

// ── Confidence badge ─────────────────────────────────────────────
function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) return null
  const colour = score >= 80 ? 'text-go bg-go-light' : score >= 60 ? 'text-caution bg-caution/10' : 'text-nogo bg-nogo/10'
  return <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', colour)}>{Math.round(score)}%</span>
}

// ── Review status badge ─────────────────────────────────────────
const REVIEW_COLOURS: Record<string, string> = {
  pending:           'text-smoke-400 bg-sand-200',
  in_review:         'text-caution bg-caution/10',
  approved:          'text-go bg-go-light',
  changes_requested: 'text-nogo bg-nogo/10',
  rewritten:         'text-info bg-info/10',
}
const REVIEW_LABELS: Record<string, string> = {
  pending: 'Pending', in_review: 'In review', approved: 'Approved',
  changes_requested: 'Changes needed', rewritten: 'Rewritten',
}

// ── Main page ────────────────────────────────────────────────────
export function GenerationPage() {
  const { id: oppId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [activeView, setActiveView]     = useState<'generate' | 'review' | 'compliance' | 'export' | 'submit'>('generate')
  const [selectedSection, setSelectedSection] = useState<any | null>(null)
  const [generating, setGenerating]     = useState(false)
  const [genLog, setGenLog]             = useState<string[]>([])
  const [genProgress, setGenProgress]   = useState({ current: 0, total: 0 })
  const eventSourceRef = useRef<EventSource | null>(null)

  const { data: opp } = useQuery({
    queryKey: ['opportunity', oppId],
    queryFn: () => opportunitiesApi.get(oppId!).then(r => r.data),
    enabled: !!oppId,
  })

  const { data: sectionsData, isLoading: loadingSections } = useQuery({
    queryKey: ['sections', oppId],
    queryFn: () => generationApi.sections(oppId!).then(r => r.data),
    enabled: !!oppId,
    refetchInterval: generating ? 2000 : false,
  })
  const sections: any[] = sectionsData?.sections || []

  const { data: reviewSummary } = useQuery({
    queryKey: ['review-summary', oppId],
    queryFn: () => reviewApi.summary(oppId!).then(r => r.data),
    enabled: !!oppId,
    refetchInterval: 15_000,
  })

  const { data: complianceData } = useQuery({
    queryKey: ['compliance', oppId],
    queryFn: () => complianceApi.results(oppId!).then(r => r.data),
    enabled: !!oppId,
  })

  const { data: submissionData } = useQuery({
    queryKey: ['submission', oppId],
    queryFn: () => submissionApi.get(oppId!).then(r => r.data),
    enabled: !!oppId,
  })
  const submission = submissionData?.submission

  // Initialise sections if none exist
  const initMutation = useMutation({
    mutationFn: () => generationApi.initialise(oppId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sections', oppId] }),
  })

  const handleStartGeneration = async () => {
    if (sections.length === 0) {
      await initMutation.mutateAsync()
    }
    setGenerating(true)
    setGenLog([])
    setGenProgress({ current: 0, total: 0 })

    const token = localStorage.getItem('bp_token')
    const url = `${API_BASE}/api/v1/generation/${oppId}/stream`
    const es = new EventSource(url)
    eventSourceRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.event === 'start') {
          setGenProgress({ current: 0, total: data.total })
          setGenLog(l => [...l, `Starting generation of ${data.total} sections...`])
        } else if (data.event === 'generating') {
          setGenProgress(p => ({ ...p, current: data.index }))
          setGenLog(l => [...l, `Generating: ${data.title} (${data.index}/${data.total})`])
        } else if (data.event === 'section_done') {
          setGenLog(l => [...l, `✓ ${data.section.section_title} — ${data.section.confidence_overall?.toFixed(0)}% confidence`])
          qc.invalidateQueries({ queryKey: ['sections', oppId] })
        } else if (data.event === 'complete') {
          setGenLog(l => [...l, `\n✅ Generation complete! ${data.total} sections ready for review.`])
          setGenerating(false)
          es.close()
          qc.invalidateQueries({ queryKey: ['sections', oppId] })
          qc.invalidateQueries({ queryKey: ['review-summary', oppId] })
        }
      } catch {}
    }
    es.onerror = () => {
      setGenLog(l => [...l, '⚠ Connection error — generation may still be running in background.'])
      setGenerating(false)
      es.close()
      qc.invalidateQueries({ queryKey: ['sections', oppId] })
    }
  }

  useEffect(() => {
    return () => { eventSourceRef.current?.close() }
  }, [])

  const pendingCount = sections.filter(s => s.generation_status === 'pending').length
  const doneCount    = sections.filter(s => s.generation_status === 'completed').length

  const tabs = [
    { id: 'generate',   label: 'Generate',   icon: <ZapIcon size={14} />,            badge: doneCount > 0 ? `${doneCount}` : undefined },
    { id: 'review',     label: 'Review',     icon: <MessageSquareIcon size={14} />,   badge: reviewSummary?.pending > 0 ? `${reviewSummary.pending}` : undefined },
    { id: 'compliance', label: 'Compliance', icon: <ShieldIcon size={14} />,          badge: complianceData?.overall === 'fail' ? '!' : undefined },
    { id: 'export',     label: 'Export',     icon: <DownloadIcon size={14} /> },
    { id: 'submit',     label: 'Submit',     icon: <ClipboardCheckIcon size={14} />,  badge: submission?.capture_result ? '✓' : undefined },
  ]

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-xs text-smoke-400 mb-0.5">
            <button onClick={() => navigate(`/opportunities/${oppId}`)} className="hover:text-clay-500 transition-colors">
              {opp?.name}
            </button>
            <ChevronRightIcon size={10} className="inline mx-1" />
            <span className="text-ink-500 font-medium">RFP Response</span>
          </p>
          <h1 className="text-xl font-semibold text-ink-500">Bid Generation Pipeline</h1>
        </div>
        {reviewSummary && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-smoke-500">{reviewSummary.approved}/{reviewSummary.total} approved</span>
            {reviewSummary.ready_for_export && (
              <span className="text-go font-medium bg-go-light px-2 py-1 rounded-full">Ready to export</span>
            )}
          </div>
        )}
      </div>

      {/* Pipeline progress bar */}
      <div className="card p-4 mb-6">
        <div className="flex items-center gap-1 overflow-x-auto">
          {[
            { n: 4, label: 'Generate',   done: doneCount > 0 },
            { n: 5, label: 'Confidence', done: doneCount > 0 },
            { n: 6, label: 'Review',     done: reviewSummary?.approved > 0 },
            { n: 7, label: 'Compliance', done: complianceData?.overall === 'pass' },
            { n: 8, label: 'Export',     done: false },
            { n: 9, label: 'Submit',     done: !!submission?.submitted_at },
            { n: 10, label: 'Capture',   done: !!submission?.capture_result },
          ].map((s, i, arr) => (
            <React.Fragment key={s.n}>
              <div className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 transition-colors',
                s.done ? 'bg-go-light text-go' : 'bg-sand-100 text-smoke-500')}>
                <span className={cn('w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold',
                  s.done ? 'bg-go text-white' : 'bg-sand-300 text-smoke-500')}>
                  {s.done ? '✓' : s.n}
                </span>
                {s.label}
              </div>
              {i < arr.length - 1 && <ChevronRightIcon size={12} className="text-sand-300 flex-shrink-0" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-sand-200">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveView(t.id as any)}
            className={cn('flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px relative',
              activeView === t.id ? 'border-clay-400 text-clay-600' : 'border-transparent text-smoke-500 hover:text-ink-500')}>
            {t.icon} {t.label}
            {t.badge && (
              <span className="ml-1 text-xs bg-clay-400 text-white rounded-full px-1.5 py-0.5 leading-none">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="grid lg:grid-cols-3 gap-6">
        {activeView === 'generate' && (
          <GenerateTab
            sections={sections}
            loadingSections={loadingSections}
            generating={generating}
            genLog={genLog}
            genProgress={genProgress}
            pendingCount={pendingCount}
            doneCount={doneCount}
            onStart={handleStartGeneration}
            onSelect={setSelectedSection}
            selectedSection={selectedSection}
            oppId={oppId!}
            qc={qc}
          />
        )}
        {activeView === 'review' && (
          <ReviewTab oppId={oppId!} sections={sections} summary={reviewSummary} onSelect={setSelectedSection} selectedSection={selectedSection} />
        )}
        {activeView === 'compliance' && (
          <ComplianceTab oppId={oppId!} data={complianceData} qc={qc} />
        )}
        {activeView === 'export' && (
          <ExportTab oppId={oppId!} summary={reviewSummary} opp={opp} />
        )}
        {activeView === 'submit' && (
          <SubmitTab oppId={oppId!} submission={submission} opp={opp} qc={qc} />
        )}

        {/* Section detail panel */}
        {selectedSection && (
          <SectionDetailPanel
            section={selectedSection}
            oppId={oppId!}
            onClose={() => setSelectedSection(null)}
            onUpdate={(updated: any) => {
              setSelectedSection(updated)
              qc.invalidateQueries({ queryKey: ['sections', oppId] })
            }}
          />
        )}
      </div>
    </div>
  )
}

// ── Generate tab ─────────────────────────────────────────────────
function GenerateTab({ sections, loadingSections, generating, genLog, genProgress, pendingCount, doneCount, onStart, onSelect, selectedSection, oppId, qc }: any) {
  const logEndRef = useRef<HTMLDivElement>(null)
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [genLog])

  // Fetch the opportunity to get industry for filtering lessons
  const { data: opp } = useQuery({
    queryKey: ['opportunity', oppId],
    queryFn: () => opportunitiesApi.get(oppId).then(r => r.data),
    enabled: !!oppId,
    staleTime: 60_000,
  })

  // Flagged lessons relevant to this opportunity's industry
  const { data: lessonsData } = useQuery({
    queryKey: ['flagged-lessons', opp?.industry_vertical],
    queryFn: () => kbApi.getFlaggedLessons(opp?.industry_vertical).then(r => r.data),
    enabled: !!opp,
    staleTime: 300_000,
  })
  const flaggedLessons: any[] = lessonsData?.lessons || []

  return (
    <>
      <div className="lg:col-span-2 space-y-4">
      {/* Flagged lessons from similar past bids */}
        {flaggedLessons.length > 0 && doneCount === 0 && (
          <div className="card border-caution/30 bg-caution/5">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-caution/20">
              <AlertCircleIcon size={14} className="text-caution" />
              <h3 className="text-sm font-semibold text-caution">
                {flaggedLessons.length} must-read lesson{flaggedLessons.length !== 1 ? 's' : ''} from similar past bids
              </h3>
            </div>
            <div className="divide-y divide-caution/10">
              {flaggedLessons.map((l: any) => (
                <div key={l.id} className="px-4 py-3 space-y-1.5">
                  <p className="text-xs font-semibold text-ink-500">
                    {l.document_name}
                    {l.document_outcome && (
                      <span className={cn('ml-2 font-normal',
                        l.document_outcome === 'won' ? 'text-go' : 'text-nogo')}>
                        · {l.document_outcome}
                      </span>
                    )}
                  </p>
                  {l.went_well && (
                    <p className="text-xs text-smoke-600">
                      <span className="text-go font-medium">✓ </span>{l.went_well.slice(0, 120)}{l.went_well.length > 120 ? '…' : ''}
                    </p>
                  )}
                  {l.went_poorly && (
                    <p className="text-xs text-smoke-600">
                      <span className="text-nogo font-medium">✗ </span>{l.went_poorly.slice(0, 120)}{l.went_poorly.length > 120 ? '…' : ''}
                    </p>
                  )}
                  {l.do_differently && (
                    <p className="text-xs text-smoke-600">
                      <span className="text-caution font-medium">→ </span>{l.do_differently.slice(0, 120)}{l.do_differently.length > 120 ? '…' : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Start generation card */}
        {!generating && pendingCount > 0 && (
          <div className="card p-5 border-clay-200 bg-clay-50/30">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink-500 mb-1">Ready to generate</h3>
                <p className="text-xs text-smoke-500">
                  {pendingCount} section{pendingCount !== 1 ? 's' : ''} pending · AI will generate each section using your documents and knowledge base
                </p>
              </div>
              <Button variant="primary" onClick={onStart} icon={<ZapIcon size={14} />}>
                Generate all sections
              </Button>
            </div>
          </div>
        )}

        {/* Live generation log */}
        {generating && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-ink-500 flex items-center gap-2">
                <RefreshCwIcon size={13} className="animate-spin text-clay-400" />
                Generating — {genProgress.current}/{genProgress.total}
              </h3>
              <div className="w-32 h-1.5 bg-sand-200 rounded-full overflow-hidden">
                <div className="h-full bg-clay-400 rounded-full transition-all"
                  style={{ width: `${genProgress.total ? (genProgress.current / genProgress.total * 100) : 0}%` }} />
              </div>
            </div>
            <div className="bg-ink-500 rounded-lg p-3 font-mono text-xs text-sand-200 h-36 overflow-y-auto space-y-1">
              {genLog.map((line, i) => <p key={i}>{line}</p>)}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* Section list */}
        {loadingSections ? (
          <div className="card p-8 flex justify-center"><Spinner /></div>
        ) : sections.length === 0 ? (
          <div className="card p-8 text-center">
            <ZapIcon size={28} className="text-sand-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-ink-500 mb-1">No sections initialised yet</p>
            <p className="text-xs text-smoke-500">Click "Generate all sections" to start the AI generation pipeline.</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-sand-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-500">{sections.length} sections</h3>
              <span className="text-xs text-smoke-500">{doneCount} generated · {pendingCount} pending</span>
            </div>
            <div className="divide-y divide-sand-100">
              {sections.map((s: any) => (
                <div key={s.id}
                  onClick={() => onSelect(s.id === selectedSection?.id ? null : s)}
                  className={cn('flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-sand-50 transition-colors',
                    selectedSection?.id === s.id && 'bg-clay-50')}>
                  <div className={cn('w-2 h-2 rounded-full flex-shrink-0',
                    s.generation_status === 'completed' ? 'bg-go' :
                    s.generation_status === 'generating' ? 'bg-caution animate-pulse' :
                    s.generation_status === 'failed' ? 'bg-nogo' : 'bg-sand-300')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-500 truncate">{s.section_title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn('text-xs', REVIEW_COLOURS[s.review_status] || '', 'px-1.5 py-0.5 rounded-full')}>
                        {REVIEW_LABELS[s.review_status] || s.review_status}
                      </span>
                      {s.word_count && <span className="text-xs text-smoke-400">{s.word_count}w</span>}
                    </div>
                  </div>
                  <ConfidenceBadge score={s.confidence_overall} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right stats */}
      <div className="space-y-4">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink-500 mb-3">Generation status</h3>
          <div className="space-y-2 text-xs">
            {[
              { label: 'Completed', value: sections.filter((s: any) => s.generation_status === 'completed').length, colour: 'text-go' },
              { label: 'Generating', value: sections.filter((s: any) => s.generation_status === 'generating').length, colour: 'text-caution' },
              { label: 'Pending', value: sections.filter((s: any) => s.generation_status === 'pending').length, colour: 'text-smoke-400' },
              { label: 'Failed', value: sections.filter((s: any) => s.generation_status === 'failed').length, colour: 'text-nogo' },
            ].map(r => (
              <div key={r.label} className="flex justify-between">
                <span className="text-smoke-500">{r.label}</span>
                <span className={cn('font-semibold', r.colour)}>{r.value}</span>
              </div>
            ))}
            <div className="pt-2 border-t border-sand-100 flex justify-between">
              <span className="text-smoke-500">Avg confidence</span>
              <span className="font-semibold text-ink-500">
                {sections.filter((s: any) => s.confidence_overall).length > 0
                  ? `${Math.round(sections.reduce((acc: number, s: any) => acc + (s.confidence_overall || 0), 0) / sections.filter((s: any) => s.confidence_overall).length)}%`
                  : '—'
                }
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Review tab ───────────────────────────────────────────────────
function ReviewTab({ oppId, sections, summary, onSelect, selectedSection }: any) {
  return (
    <>
      <div className="lg:col-span-2 space-y-3">
        {summary && (
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Approved', value: summary.approved, colour: 'text-go' },
              { label: 'In review', value: summary.in_review, colour: 'text-caution' },
              { label: 'Changes needed', value: summary.changes_requested, colour: 'text-nogo' },
              { label: 'Low confidence', value: summary.low_confidence, colour: 'text-smoke-500' },
            ].map(s => (
              <div key={s.label} className="card p-3 text-center">
                <p className={cn('text-2xl font-bold', s.colour)}>{s.value}</p>
                <p className="text-xs text-smoke-500">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="divide-y divide-sand-100">
            {sections.filter((s: any) => s.generation_status === 'completed').map((s: any) => (
              <div key={s.id} onClick={() => onSelect(s.id === selectedSection?.id ? null : s)}
                className={cn('flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-sand-50 transition-colors',
                  selectedSection?.id === s.id && 'bg-clay-50')}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-500 truncate">{s.section_title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium',
                      REVIEW_COLOURS[s.review_status] || '')}>
                      {REVIEW_LABELS[s.review_status]}
                    </span>
                    {s.reviewer_name && (
                      <span className="text-xs text-smoke-400 flex items-center gap-1">
                        <UserIcon size={10} /> {s.reviewer_name}
                      </span>
                    )}
                  </div>
                </div>
                <ConfidenceBadge score={s.confidence_overall} />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-4">
        {summary?.ready_for_export ? (
          <div className="card p-4 bg-go-light border-go/20">
            <p className="text-sm font-semibold text-go mb-1">All sections approved</p>
            <p className="text-xs text-go/80">You can now run compliance checks and export the document.</p>
          </div>
        ) : (
          <div className="card p-4">
            <p className="text-sm font-semibold text-ink-500 mb-2">Review progress</p>
            <div className="w-full h-2 bg-sand-200 rounded-full overflow-hidden">
              <div className="h-full bg-go rounded-full transition-all"
                style={{ width: `${summary?.total ? (summary.approved / summary.total * 100) : 0}%` }} />
            </div>
            <p className="text-xs text-smoke-500 mt-1.5">
              {summary?.approved || 0} of {summary?.total || 0} sections approved
            </p>
          </div>
        )}
      </div>
    </>
  )
}

// ── Compliance tab ────────────────────────────────────────────────
function ComplianceTab({ oppId, data, qc }: any) {
  const [running, setRunning] = useState(false)

  const handleRun = async () => {
    setRunning(true)
    try {
      await complianceApi.run(oppId)
      qc.invalidateQueries({ queryKey: ['compliance', oppId] })
    } finally {
      setRunning(false)
    }
  }

  const statusIcon = (status: string) => {
    if (status === 'pass') return <CheckCircle2Icon size={16} className="text-go" />
    if (status === 'warn') return <AlertCircleIcon size={16} className="text-caution" />
    return <AlertCircleIcon size={16} className="text-nogo" />
  }

  return (
    <div className="lg:col-span-3 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink-500">Pre-export compliance checks</h3>
          <p className="text-xs text-smoke-500 mt-0.5">Run before exporting to ensure the bid is complete and ready.</p>
        </div>
        <Button variant="primary" onClick={handleRun} loading={running} icon={<ShieldIcon size={14} />}>
          Run checks
        </Button>
      </div>

      {data?.checks?.length > 0 ? (
        <div className="card overflow-hidden">
          <div className={cn('px-4 py-3 border-b border-sand-100 flex items-center gap-2',
            data.overall === 'pass' ? 'bg-go-light' : data.overall === 'warn' ? 'bg-caution/5' : 'bg-nogo/5')}>
            {statusIcon(data.overall)}
            <span className={cn('text-sm font-semibold',
              data.overall === 'pass' ? 'text-go' : data.overall === 'warn' ? 'text-caution' : 'text-nogo')}>
              Overall: {data.overall === 'pass' ? 'Ready to export' : data.overall === 'warn' ? 'Warnings — review before exporting' : 'Blocking issues found'}
            </span>
          </div>
          <div className="divide-y divide-sand-100">
            {data.checks.map((c: any) => (
              <div key={c.id} className="flex items-start gap-3 px-4 py-3">
                {statusIcon(c.status)}
                <div className="flex-1">
                  <p className="text-sm font-medium text-ink-500">{c.check_name}</p>
                  <p className="text-xs text-smoke-500 mt-0.5">{c.detail}</p>
                </div>
                <span className="text-xs text-smoke-400 capitalize">{c.check_category}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="card p-8 text-center">
          <ShieldIcon size={28} className="text-sand-300 mx-auto mb-3" />
          <p className="text-sm text-smoke-500">No compliance checks run yet. Click "Run checks" to validate the bid.</p>
        </div>
      )}
    </div>
  )
}

// ── Export tab ────────────────────────────────────────────────────
function ExportTab({ oppId, summary, opp }: any) {
  const qc = useQueryClient()
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [approvedOnly, setApprovedOnly] = useState(false)
  const [msg, setMsg] = useState('')

  const { data: preview } = useQuery({
    queryKey: ['export-preview', oppId],
    queryFn: () => exportApi.preview(oppId).then(r => r.data),
    enabled: !!oppId,
  })

  const handleUploadTemplate = async () => {
    if (!templateFile) return
    setUploading(true)
    try {
      await exportApi.uploadTemplate(oppId, templateFile)
      qc.invalidateQueries({ queryKey: ['export-preview', oppId] })
      setMsg('Template uploaded successfully.')
      setTemplateFile(null)
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'Upload failed.')
    } finally { setUploading(false) }
  }

  const downloadUrl = exportApi.downloadUrl(oppId, approvedOnly) +
    `&token=${localStorage.getItem('bp_token')}`

  return (
    <div className="lg:col-span-3 grid lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink-500 mb-3">Export preview</h3>
          {preview ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-smoke-500">Sections</span><span className="font-medium">{preview.section_count}</span></div>
              <div className="flex justify-between"><span className="text-smoke-500">Total words</span><span className="font-medium">{preview.total_words?.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="text-smoke-500">Template</span><span className="font-medium">{preview.has_custom_template ? 'Custom' : 'Default'}</span></div>
            </div>
          ) : <Spinner />}

          <div className="mt-4 pt-4 border-t border-sand-100 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={approvedOnly} onChange={e => setApprovedOnly(e.target.checked)}
                className="w-3.5 h-3.5 accent-clay-400" />
              <span className="text-xs text-smoke-500">Export approved sections only</span>
            </label>
            <a href={downloadUrl} target="_blank" rel="noreferrer">
              <Button variant="primary" className="w-full" icon={<DownloadIcon size={14} />}>
                Download Word document (.docx)
              </Button>
            </a>
            <a href={`${exportApi.pptxUrl(oppId!)}&token=${localStorage.getItem('bp_token')}`}
               target="_blank" rel="noreferrer">
              <Button variant="secondary" className="w-full" icon={<DownloadIcon size={14} />}>
                Download PowerPoint summary (.pptx)
              </Button>
            </a>

            {/* Template help */}
            <div className="pt-3 border-t border-sand-100">
              <p className="text-xs font-semibold text-smoke-500 mb-1">Custom template</p>
              <p className="text-xs text-smoke-400 mb-2">
                Upload a branded .docx template above. Add Word bookmarks at positions where
                content should be injected: <code className="bg-sand-100 px-1 rounded">BID_TITLE</code>,{' '}
                <code className="bg-sand-100 px-1 rounded">BID_CLIENT</code>,{' '}
                <code className="bg-sand-100 px-1 rounded">SECTION_1</code> …{' '}
                <code className="bg-sand-100 px-1 rounded">SECTION_n</code>.
                If no bookmarks are found, sections are appended after the template body.
              </p>
              <a href={`${BASE}/export/template-guide`} target="_blank" rel="noreferrer"
                 className="text-xs text-clay-500 hover:text-clay-700 transition-colors">
                View full bookmark reference →
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink-500 mb-1">Custom template</h3>
          <p className="text-xs text-smoke-500 mb-3">Upload a branded .docx template. Section content will be inserted into the template structure.</p>
          {msg && <p className="text-xs text-go mb-2">{msg}</p>}
          <div className="space-y-2">
            <input type="file" accept=".docx"
              onChange={e => setTemplateFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-smoke-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-sand-200 file:text-ink-500 hover:file:bg-sand-300 cursor-pointer" />
            {templateFile && (
              <Button onClick={handleUploadTemplate} loading={uploading} variant="secondary" className="w-full">
                Upload {templateFile.name}
              </Button>
            )}
            {preview?.has_custom_template && (
              <button onClick={async () => { await exportApi.deleteTemplate(oppId); qc.invalidateQueries({ queryKey: ['export-preview', oppId] }) }}
                className="text-xs text-nogo hover:underline">
                Remove custom template
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Submit tab ────────────────────────────────────────────────────
function SubmitTab({ oppId, submission, opp, qc }: any) {
  const [subMethod, setSubMethod] = useState(submission?.submission_method || '')
  const [subRef, setSubRef]       = useState(submission?.confirmation_ref || '')
  const [result, setResult]       = useState(submission?.capture_result || '')
  const [score, setScore]         = useState(submission?.score_received || '')
  const [notes, setNotes]         = useState(submission?.capture_notes || '')
  const [feedback, setFeedback]   = useState(submission?.feedback_received || '')
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState('')

  const handleSubmit = async () => {
    setSaving(true)
    try {
      await submissionApi.submit(oppId, { submission_method: subMethod, confirmation_ref: subRef })
      qc.invalidateQueries({ queryKey: ['submission', oppId] })
      qc.invalidateQueries({ queryKey: ['opportunity', oppId] })
      setMsg('Submission recorded.')
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'Failed to record submission.')
    } finally { setSaving(false) }
  }

  const handleCapture = async () => {
    if (!result) { setMsg('Please select a capture result.'); return }
    setSaving(true)
    try {
      await submissionApi.capture(oppId, { capture_result: result, score_received: score, capture_notes: notes, feedback_received: feedback })
      qc.invalidateQueries({ queryKey: ['submission', oppId] })
      qc.invalidateQueries({ queryKey: ['opportunity', oppId] })
      setMsg('Result captured. Remember to add lessons learned to the Knowledge Base.')
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'Failed to capture result.')
    } finally { setSaving(false) }
  }

  return (
    <div className="lg:col-span-3 grid lg:grid-cols-2 gap-6">
      {/* Stage 9: Submission */}
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-500">Stage 9 — Record submission</h3>
          <p className="text-xs text-smoke-500 mt-0.5">Record that the bid has been submitted to the client.</p>
        </div>
        {submission?.submitted_at && (
          <div className="rounded-lg bg-go-light border border-go/20 p-3">
            <p className="text-xs text-go font-medium">
              ✓ Submitted {new Date(submission.submitted_at).toLocaleDateString()} by {submission.submitted_by_name}
              {submission.confirmation_ref && ` · Ref: ${submission.confirmation_ref}`}
            </p>
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-smoke-500 mb-1">Submission method</label>
            <select value={subMethod} onChange={e => setSubMethod(e.target.value)}
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none bg-white">
              <option value="">Select method</option>
              <option value="portal">Client portal</option>
              <option value="email">Email</option>
              <option value="physical">Physical/post</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-smoke-500 mb-1">Confirmation reference</label>
            <input value={subRef} onChange={e => setSubRef(e.target.value)} placeholder="Portal reference or email subject"
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
          </div>
          <Button variant="primary" onClick={handleSubmit} loading={saving} className="w-full">
            Record submission
          </Button>
        </div>
      </div>

      {/* Stage 10: Capture result */}
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-500">Stage 10 — Capture result</h3>
          <p className="text-xs text-smoke-500 mt-0.5">Record the bid outcome and close the learning loop.</p>
        </div>
        {submission?.capture_result && (
          <div className={cn('rounded-lg p-3 border',
            submission.capture_result === 'won' ? 'bg-go-light border-go/20' : 'bg-sand-100 border-sand-200')}>
            <p className={cn('text-xs font-medium', submission.capture_result === 'won' ? 'text-go' : 'text-smoke-600')}>
              Result: {submission.capture_result} {submission.score_received && `· ${submission.score_received}`}
            </p>
          </div>
        )}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-smoke-500 mb-1">Result</label>
            <select value={result} onChange={e => setResult(e.target.value)}
              className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none bg-white">
              <option value="">Select result</option>
              <option value="won">Won ✓</option>
              <option value="lost">Lost</option>
              <option value="shortlisted">Shortlisted</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="no_bid">No bid submitted</option>
            </select>
          </div>
          <input value={score} onChange={e => setScore(e.target.value)} placeholder="Score / ranking (e.g. 78/100, 2nd of 5)"
            className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
          <textarea value={feedback} onChange={e => setFeedback(e.target.value)} rows={2}
            placeholder="Client / evaluator feedback received..."
            className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none resize-none" />
          <Button variant="primary" onClick={handleCapture} loading={saving} className="w-full">
            Capture result
          </Button>
          {msg && <p className="text-xs text-go">{msg}</p>}
        </div>

        {/* Stage 16 KB loop prompt */}
        {submission?.capture_result && !submission.kb_promoted && (
          <div className="rounded-lg bg-clay-50 border border-clay-100 p-3 space-y-2">
            <p className="text-xs font-semibold text-clay-600">Stage 16 — KB Learning Loop</p>
            <p className="text-xs text-clay-600">Add this bid to the knowledge base so future bids can learn from it.</p>
            <a href={`/knowledge-base`} className="text-xs text-clay-500 underline hover:no-underline flex items-center gap-1">
              <BookOpenIcon size={11} /> Go to Knowledge Base <ArrowRightIcon size={11} />
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Section detail panel ──────────────────────────────────────────
function SectionDetailPanel({ section, oppId, onClose, onUpdate }: any) {
  const qc = useQueryClient()
  const [editing, setEditing]         = useState(false)
  const [editContent, setEditContent] = useState(section.edited_content || section.generated_content || '')
  const [comment, setComment]         = useState('')
  const [saving, setSaving]           = useState(false)
  const [assigning, setAssigning]     = useState(false)

  // Reload section data when section prop changes
  useEffect(() => {
    setEditContent(section.edited_content || section.generated_content || '')
    setEditing(false)
  }, [section.id])

  const { data: sectionDetail } = useQuery({
    queryKey: ['section-detail', section.id],
    queryFn: () => reviewApi.getSection(section.id).then(r => r.data),
    refetchInterval: 10_000,
  })
  const detail = sectionDetail || section
  const annotations = detail.annotations || []

  const handleSaveEdit = async () => {
    setSaving(true)
    try {
      const updated = await reviewApi.edit(section.id, editContent)
      onUpdate(updated.data)
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['section-detail', section.id] })
    } finally { setSaving(false) }
  }

  const handleDecide = async (decision: string) => {
    setSaving(true)
    try {
      const updated = await reviewApi.decide(section.id, decision, comment || undefined)
      onUpdate(updated.data)
      setComment('')
      qc.invalidateQueries({ queryKey: ['section-detail', section.id] })
      qc.invalidateQueries({ queryKey: ['review-summary', oppId] })
    } finally { setSaving(false) }
  }

  const handleAddComment = async () => {
    if (!comment.trim()) return
    await reviewApi.addAnnotation(section.id, { content: comment, annotation_type: 'comment' })
    setComment('')
    qc.invalidateQueries({ queryKey: ['section-detail', section.id] })
  }

  const handleRegenerate = async () => {
    setSaving(true)
    try {
      const updated = await generationApi.regenerate(oppId, section.id)
      onUpdate(updated.data)
      qc.invalidateQueries({ queryKey: ['sections', oppId] })
    } finally { setSaving(false) }
  }

  const displayContent = detail.edited_content || detail.generated_content || ''

  return (
    <div className="lg:col-span-3 card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-sand-100">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="text-sm font-semibold text-ink-500 truncate">{detail.section_title}</h3>
          <ConfidenceBadge score={detail.confidence_overall} />
          <span className={cn('text-xs px-1.5 py-0.5 rounded-full', REVIEW_COLOURS[detail.review_status] || '')}>
            {REVIEW_LABELS[detail.review_status]}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {!editing && (
            <>
              <button onClick={() => setEditing(true)}
                className="flex items-center gap-1 text-xs text-clay-500 hover:text-clay-700 transition-colors px-2 py-1 rounded hover:bg-clay-50">
                <EditIcon size={12} /> Edit
              </button>
              <button onClick={handleRegenerate} disabled={saving}
                className="flex items-center gap-1 text-xs text-smoke-500 hover:text-ink-500 transition-colors px-2 py-1 rounded hover:bg-sand-100">
                <RefreshCwIcon size={12} /> Regenerate
              </button>
            </>
          )}
          <button onClick={onClose} className="text-smoke-400 hover:text-nogo transition-colors p-1">✕</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3">
        {/* Content */}
        <div className="lg:col-span-2 p-5 border-r border-sand-100">
          {/* Confidence breakdown */}
          {detail.confidence_overall && (
            <div className="mb-4 p-3 bg-sand-50 rounded-lg">
              {(() => {
                let rationale: any = {}
                try { rationale = detail.prompt_used ? JSON.parse(detail.prompt_used) : {} } catch {}
                const isLLM = rationale.method === 'llm'
                return (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-semibold text-smoke-500 uppercase tracking-wide">Confidence scores</span>
                      <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium',
                        isLLM ? 'bg-teal-50 text-teal-700' : 'bg-sand-200 text-smoke-500')}>
                        {isLLM ? 'AI-evaluated' : 'Rule-based'}
                      </span>
                    </div>
                    <div className="flex gap-4">
                      {[
                        { label: 'Complete', val: detail.confidence_complete, reason: rationale.completeness_reason },
                        { label: 'Relevant', val: detail.confidence_relevance, reason: rationale.relevance_reason },
                        { label: 'Tone',     val: detail.confidence_tone,       reason: rationale.tone_reason },
                        { label: 'Risk',     val: detail.confidence_risk,        reason: rationale.risk_reason },
                      ].map(d => (
                        <div key={d.label} className="text-center flex-1" title={d.reason || ''}>
                          <p className={cn('text-sm font-bold',
                            (d.val || 0) >= 70 ? 'text-go' : (d.val || 0) >= 50 ? 'text-caution' : 'text-nogo')}>
                            {d.val?.toFixed(0) || '—'}
                          </p>
                          <p className="text-xs text-smoke-400">{d.label}</p>
                          {d.reason && (
                            <p className="text-xs text-smoke-400 mt-0.5 leading-tight hidden group-hover:block">{d.reason}</p>
                          )}
                        </div>
                      ))}
                    </div>
                    {isLLM && rationale.completeness_reason && (
                      <div className="mt-2 pt-2 border-t border-sand-200 space-y-1">
                        {[
                          { label: 'Completeness', reason: rationale.completeness_reason },
                          { label: 'Relevance',    reason: rationale.relevance_reason },
                          { label: 'Tone',         reason: rationale.tone_reason },
                          { label: 'Risk',         reason: rationale.risk_reason },
                        ].filter(d => d.reason).map(d => (
                          <p key={d.label} className="text-xs text-smoke-500 leading-relaxed">
                            <span className="font-medium text-smoke-600">{d.label}: </span>{d.reason}
                          </p>
                        ))}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          {editing ? (
            <div className="space-y-3">
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                rows={18}
                className="w-full text-sm border border-sand-300 rounded-lg px-3 py-2 focus:border-clay-400 focus:outline-none resize-none font-mono"
              />
              <div className="flex gap-2">
                <Button variant="primary" onClick={handleSaveEdit} loading={saving}>Save changes</Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="prose prose-sm max-w-none text-ink-500 text-sm leading-relaxed">
              {displayContent ? (
                displayContent.split('\n').map((line: string, i: number) => {
                  if (!line.trim()) return <br key={i} />
                  if (line.startsWith('## ')) return <h2 key={i} className="text-base font-semibold mt-4 mb-2">{line.slice(3)}</h2>
                  if (line.startsWith('### ')) return <h3 key={i} className="text-sm font-semibold mt-3 mb-1">{line.slice(4)}</h3>
                  if (line.startsWith('- ') || line.startsWith('• ')) return <li key={i} className="ml-4 list-disc">{line.slice(2)}</li>
                  if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-semibold">{line.slice(2,-2)}</p>
                  return <p key={i} className="mb-2">{line}</p>
                })
              ) : (
                <p className="text-smoke-400 italic">No content generated yet.</p>
              )}
            </div>
          )}
        </div>

        {/* Review panel */}
        <div className="p-4 space-y-4">
          {/* Reviewer */}
          <div>
            <p className="text-xs font-semibold text-smoke-500 uppercase tracking-wide mb-2">Reviewer</p>
            {detail.reviewer_name ? (
              <p className="text-xs text-ink-500 flex items-center gap-1.5">
                <UserIcon size={12} className="text-smoke-400" /> {detail.reviewer_name}
              </p>
            ) : (
              <p className="text-xs text-smoke-400">Not assigned</p>
            )}
          </div>

          {/* Decision buttons */}
          {detail.generation_status === 'completed' && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-smoke-500 uppercase tracking-wide">Decision</p>
              <button onClick={() => handleDecide('approved')} disabled={saving}
                className="w-full text-xs px-3 py-2 rounded-lg bg-go-light text-go font-medium hover:bg-go/20 transition-colors flex items-center gap-2">
                <CheckCircle2Icon size={13} /> Approve section
              </button>
              <button onClick={() => handleDecide('changes_requested')} disabled={saving}
                className="w-full text-xs px-3 py-2 rounded-lg bg-nogo/10 text-nogo font-medium hover:bg-nogo/20 transition-colors flex items-center gap-2">
                <AlertCircleIcon size={13} /> Request changes
              </button>
            </div>
          )}

          {/* Annotations */}
          <div>
            <p className="text-xs font-semibold text-smoke-500 uppercase tracking-wide mb-2">Comments ({annotations.length})</p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {annotations.map((a: any) => (
                <div key={a.id} className={cn('rounded-lg p-2.5 text-xs',
                  a.annotation_type === 'approved' ? 'bg-go-light' :
                  a.annotation_type === 'changes_requested' ? 'bg-nogo/10' : 'bg-sand-100',
                  a.resolved && 'opacity-50')}>
                  <p className="font-medium text-ink-500">{a.author_name}</p>
                  <p className="text-smoke-600 mt-0.5">{a.content}</p>
                  <p className="text-smoke-400 mt-1">{timeAgo(a.created_at)}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={comment} onChange={e => setComment(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddComment()}
                placeholder="Add comment..."
                className="flex-1 text-xs border border-sand-300 rounded-lg px-2.5 py-1.5 focus:border-clay-400 focus:outline-none" />
              <button onClick={handleAddComment}
                className="px-2 py-1.5 bg-clay-400 text-white text-xs rounded-lg hover:bg-clay-500 transition-colors">
                <PlusIcon size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
