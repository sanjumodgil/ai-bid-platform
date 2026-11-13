import React, { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { opportunitiesApi, documentsApi, bidTeamApi, integrationsApi } from '../lib/api'
import { Button, Badge, CFAVScore, Spinner, ProgressBar, SectionHeader } from '../components/ui'
import {
  STATUS_CONFIG, GONOGO_CONFIG, INDUSTRY_LABELS, INDUSTRY_SUBDOMAINS, formatDate, formatDatetime,
  timeAgo, formatFileSize, DOC_STATUS_CONFIG, cn
} from '../lib/utils'
import type { Opportunity, Document, Requirement, GoNoGoStatus, DocumentStatus } from '../types'
import {
  UploadIcon, FileTextIcon, CheckCircle2Icon, AlertCircleIcon,
  ChevronRightIcon, ActivityIcon, RefreshCwIcon, Trash2Icon, BarChart2Icon,
  SearchIcon, BookOpenIcon, ZapIcon, ArrowRightIcon, PlusIcon, UsersIcon
} from '../components/ui/icons'
// ── Stage tabs ────────────────────────────────────────────────────
const STAGE_TABS = [
  { id: 'overview',      label: 'Overview',          stage: null },
  { id: 'documents',     label: 'Documents',         stage: 2 },
  { id: 'requirements',  label: 'Requirements',      stage: 2 },
  { id: 'cfav',          label: 'Go / No-Go',        stage: 3 },
  { id: 'knowledge',     label: 'Knowledge Base',    stage: null },
  { id: 'team',          label: 'Bid Team',          stage: null },
  { id: 'activity',      label: 'Activity',          stage: null },
]

export function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('overview')
  const qc = useQueryClient()

  const { data: opp, isLoading } = useQuery<Opportunity>({
    queryKey: ['opportunity', id],
    queryFn: () => opportunitiesApi.get(id!).then(r => r.data),
    enabled: !!id,
    refetchInterval: 30_000,
  })

  if (isLoading || !opp) return <div className="flex items-center justify-center h-48"><Spinner /></div>

  const sc = STATUS_CONFIG[opp.status]
  const gc = GONOGO_CONFIG[opp.go_no_go_status]

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Badge color={sc?.color} bg={sc?.bg}>{sc?.label}</Badge>
            {opp.go_no_go_status !== 'pending' && (
              <span className={cn('badge text-xs', gc?.color, gc?.bg)}>
                {gc?.icon} {gc?.label}
              </span>
            )}
          </div>
          <h1 className="text-xl font-semibold text-ink-500 truncate">{opp.name}</h1>
          <p className="text-sm text-smoke-500 mt-0.5">
            {opp.client_name} · {INDUSTRY_LABELS[opp.industry_vertical] || opp.industry_vertical}
            {opp.sub_domain && ` › ${INDUSTRY_SUBDOMAINS[opp.industry_vertical]?.find(s => s.value === opp.sub_domain)?.label || opp.sub_domain}`}
          </p>
        </div>
        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          <CFAVScore score={opp.cfav_score} size="lg" />
          {['under_review', 'submitted', 'under_evaluation', 'shortlisted'].includes(opp.status) && (
            <button onClick={() => navigate(`/opportunities/${opp.id}/generate`)}
              className="flex items-center gap-1.5 px-3 py-2 bg-clay-400 text-white text-sm font-medium rounded-lg hover:bg-clay-500 transition-colors">
              <ZapIcon size={14} /> Generate RFP
            </button>
          )}
          {['shortlisted'].includes(opp.status) && (
            <button onClick={() => navigate(`/opportunities/${opp.id}/orals`)}
              className="flex items-center gap-1.5 px-3 py-2 bg-ink-500 text-white text-sm font-medium rounded-lg hover:bg-ink-400 transition-colors">
              <BarChart2Icon size={14} /> Orals Track
            </button>
          )}
        </div>
      </div>

      {/* Pipeline stage indicator */}
      <div className="card p-4 mb-6 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {[
            { n: 1, label: 'Registration', done: true },
            { n: 2, label: 'Ingestion',    done: opp.document_count > 0 },
            { n: 3, label: 'Go / No-Go',   done: opp.go_no_go_status !== 'pending' },
            { n: 4, label: 'Generation', done: ['under_review','submitted','under_evaluation','shortlisted','won_direct','lost_at_rfp'].includes(opp.status), link: `/opportunities/${opp.id}/generate` },
            { n: '5', label: 'Orals', done: ['won_direct','lost_at_rfp'].includes(opp.status) && opp.oral_status !== null, link: opp.status === 'shortlisted' ? `/opportunities/${opp.id}/orals` : undefined },
          ].map((s, i, arr) => (
            <div key={String(s.n)} className="contents">
              <div
                onClick={() => (s as any).link && navigate((s as any).link)}
                title={s.label === 'Orals' ? 'Stages 11–15: Orals Track' : undefined}
                className={cn('flex items-center gap-2 px-3 py-2 rounded-lg',
                  s.done ? 'bg-go-light' : 'bg-sand-100',
                  (s as any).link ? 'cursor-pointer hover:opacity-80 transition-opacity' : '')}>
                <div className={cn('w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0',
                  s.done ? 'bg-go text-white' : 'bg-sand-300 text-smoke-500')}>
                  {s.done ? <CheckCircle2Icon size={11} /> : s.n}
                </div>
                <span className={cn('text-xs font-medium', s.done ? 'text-go' : 'text-smoke-500')}>
                  {s.label}
                </span>
              </div>
              {i < arr.length - 1 && <ChevronRightIcon size={13} className="text-sand-300 flex-shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-sand-200">
        {STAGE_TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn('px-4 py-2.5 text-sm font-medium transition-all duration-150 border-b-2 -mb-px',
              activeTab === t.id
                ? 'border-clay-400 text-clay-600'
                : 'border-transparent text-smoke-500 hover:text-ink-500')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="animate-fade-in">
        {activeTab === 'overview'     && <OverviewTab opp={opp} />}
        {activeTab === 'documents'    && <DocumentsTab opp={opp} />}
        {activeTab === 'requirements' && <RequirementsTab oppId={opp.id} />}
        {activeTab === 'cfav'         && <CFAVTab opp={opp} />}
        {activeTab === 'knowledge'    && <KnowledgeTab opp={opp} />}
        {activeTab === 'team'         && <BidTeamTab opp={opp} />}
        {activeTab === 'activity'     && <ActivityTab oppId={opp.id} />}
      </div>
    </div>
  )
}

// ── Overview tab ──────────────────────────────────────────────────
function OverviewTab({ opp }: { opp: Opportunity }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name:                   opp.name,
    client_name:            opp.client_name,
    procurement_reference:  opp.procurement_reference || '',
    industry_vertical:      opp.industry_vertical,
    sub_domain:             opp.sub_domain || '',
    solution_type:          opp.solution_type || '',
    geography:              opp.geography || '',
    estimated_value:        opp.estimated_value?.toString() || '',
    submission_deadline:    opp.submission_deadline?.slice(0, 16) || '',
    notes:                  opp.notes || '',
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      await opportunitiesApi.update(opp.id, {
        ...form,
        estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : null,
        submission_deadline: form.submission_deadline || null,
        sub_domain: form.sub_domain || null,
        solution_type: form.solution_type || null,
        geography: form.geography || null,
        procurement_reference: form.procurement_reference || null,
      })
      qc.invalidateQueries({ queryKey: ['opportunity', opp.id] })
      setEditing(false)
    } catch (e: any) {
      alert(e?.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const subDomains = INDUSTRY_SUBDOMAINS[form.industry_vertical] || []
  const f = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(v => ({ ...v, [key]: e.target.value }))

  if (editing) {
    return (
      <div className="space-y-4">
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-ink-500">Edit opportunity</h3>
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs bg-sand-200 text-smoke-600 rounded-lg hover:bg-sand-300 transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs bg-clay-400 text-white rounded-lg hover:bg-clay-500 disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-smoke-500 mb-1">Opportunity name</label>
              <input value={form.name} onChange={f('name')} className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Client name</label>
              <input value={form.client_name} onChange={f('client_name')} className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Procurement reference</label>
              <input value={form.procurement_reference} onChange={f('procurement_reference')} placeholder="ITT-2025-001" className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Industry</label>
              <select value={form.industry_vertical} onChange={e => setForm(v => ({ ...v, industry_vertical: e.target.value, sub_domain: '' }))}
                className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none bg-white">
                {Object.entries(INDUSTRY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Sub-domain</label>
              <select value={form.sub_domain} onChange={f('sub_domain')}
                disabled={subDomains.length === 0}
                className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none bg-white disabled:opacity-50">
                <option value="">Select (optional)</option>
                {subDomains.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Solution type</label>
              <input value={form.solution_type} onChange={f('solution_type')} placeholder="e.g. Cloud Migration" className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Geography</label>
              <input value={form.geography} onChange={f('geography')} placeholder="e.g. UK, EU" className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Estimated value (£)</label>
              <input type="number" value={form.estimated_value} onChange={f('estimated_value')} placeholder="0" className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Submission deadline</label>
              <input type="datetime-local" value={form.submission_deadline} onChange={f('submission_deadline')} className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-smoke-500 mb-1">Notes</label>
              <textarea value={form.notes} onChange={f('notes')} rows={3} className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none resize-none" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-ink-500">Details</h3>
            <button onClick={() => setEditing(true)}
              className="text-xs text-clay-500 hover:text-clay-700 transition-colors px-2 py-1 rounded hover:bg-clay-50">
              ✏ Edit
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Client', opp.client_name],
              ['Reference', opp.procurement_reference || '—'],
              ['Industry', [
                INDUSTRY_LABELS[opp.industry_vertical] || opp.industry_vertical,
                opp.sub_domain && (INDUSTRY_SUBDOMAINS[opp.industry_vertical]?.find(s => s.value === opp.sub_domain)?.label || opp.sub_domain)
              ].filter(Boolean).join(' › ')],
              ['Geography', opp.geography || '—'],
              ['Solution type', opp.solution_type || '—'],
              ['Estimated value', opp.estimated_value ? `£${opp.estimated_value.toLocaleString()}` : '—'],
              ['Submission deadline', formatDate(opp.submission_deadline)],
              ['Bid lead', opp.bid_lead_name || '—'],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-xs text-smoke-500">{k}</p>
                <p className="font-medium text-ink-500">{v}</p>
              </div>
            ))}
          </div>
        </div>
        {opp.notes && (
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-ink-500 mb-2">Notes</h3>
            <p className="text-sm text-smoke-500 leading-relaxed">{opp.notes}</p>
          </div>
        )}
      </div>
      <div className="space-y-4">
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink-500 mb-3">Pipeline metrics</h3>
          <div className="space-y-3">
            {[
              { label: 'Documents', value: opp.document_count },
              { label: 'Requirements', value: opp.requirement_count },
              { label: 'CFAV score', value: opp.cfav_score !== null ? `${Math.round(opp.cfav_score)}/100` : 'Pending' },
            ].map(m => (
              <div key={m.label} className="flex justify-between text-sm">
                <span className="text-smoke-500">{m.label}</span>
                <span className="font-medium text-ink-500">{m.value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink-500 mb-3">Timeline</h3>
          <div className="space-y-2 text-xs text-smoke-500">
            <div className="flex justify-between"><span>Created</span><span>{formatDatetime(opp.created_at)}</span></div>
            <div className="flex justify-between"><span>Last updated</span><span>{timeAgo(opp.updated_at)}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Documents tab ─────────────────────────────────────────────────
function DocumentsTab({ opp }: { opp: Opportunity }) {
  const qc = useQueryClient()
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [docType, setDocType] = useState<string>('rfp')

  const { data: docs = [], refetch } = useQuery<Document[]>({
    queryKey: ['documents', opp.id],
    queryFn: () => documentsApi.listByOpportunity(opp.id).then(r => r.data),
    refetchInterval: 5_000,
  })

  // Poll processing documents
  const processingDocs = docs.filter(d => d.status === 'processing' || d.status === 'uploading')

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('opportunity_id', opp.id)
      fd.append('doc_type', docType)
      try {
        await documentsApi.upload(fd)
      } catch (e: any) {
        console.error('Upload failed:', e.response?.data?.detail)
      }
    }
    setUploading(false)
    refetch()
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [docType, opp.id])

  return (
    <div className="space-y-6">
      {/* Upload zone */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <select value={docType} onChange={e => setDocType(e.target.value)}
            className="text-sm rounded-lg border border-sand-300 bg-white px-3 py-1.5 focus:border-clay-400 focus:outline-none">
            <option value="rfp">RFP Document</option>
            <option value="requirements_excel">Requirements (Excel)</option>
            <option value="past_proposal">Past Proposal</option>
            <option value="supporting">Supporting Document</option>
          </select>
        </div>
        <div
          className={cn('drop-zone', dragging && 'dragging')}
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <input id="file-input" type="file" className="hidden" accept=".pdf,.docx,.doc,.xlsx,.xls"
            multiple onChange={e => handleFiles(e.target.files)} />
          <UploadIcon size={24} className={cn('mx-auto mb-2', dragging ? 'text-clay-400' : 'text-smoke-300')} />
          <p className="text-sm font-medium text-ink-500">Drop files here or click to upload</p>
          <p className="text-xs text-smoke-500 mt-1">PDF, DOCX, XLSX · Max 100MB per file</p>
          {uploading && <p className="text-xs text-clay-500 mt-2 flex items-center gap-1 justify-center"><RefreshCwIcon size={12} className="animate-spin" /> Uploading...</p>}
        </div>
      </div>

      {/* Document list */}
      {docs.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3 border-b border-sand-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink-500">Documents ({docs.length})</h3>
            {processingDocs.length > 0 && (
              <span className="text-xs text-caution flex items-center gap-1">
                <RefreshCwIcon size={11} className="animate-spin" /> {processingDocs.length} processing
              </span>
            )}
          </div>
          <div className="divide-y divide-sand-100">
            {docs.map(doc => <DocRow key={doc.id} doc={doc} onDelete={() => refetch()} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function DocRow({ doc, onDelete }: { doc: Document; onDelete: () => void; key?: string }) {
  const sc = DOC_STATUS_CONFIG[doc.status as DocumentStatus]
  const { data: status } = useQuery({
    queryKey: ['doc-status', doc.id],
    queryFn: () => documentsApi.getStatus(doc.id).then(r => r.data),
    enabled: doc.status === 'processing' || doc.status === 'uploading',
    refetchInterval: 3_000,
  })

  const handleDelete = async () => {
    if (!confirm('Delete this document?')) return
    await documentsApi.delete(doc.id)
    onDelete()
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-sand-50 transition-colors">
      <FileTextIcon size={16} className="text-smoke-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink-500 truncate">{doc.original_filename}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-smoke-400">{formatFileSize(doc.file_size_bytes)}</span>
          {doc.chunk_count > 0 && <span className="text-xs text-smoke-400">{doc.chunk_count} chunks</span>}
          {doc.page_count && <span className="text-xs text-smoke-400">{doc.page_count} pages</span>}
          <span className={cn('text-xs font-medium', sc?.color)}>{sc?.label}</span>
        </div>
        {(doc.status === 'processing') && (
          <ProgressBar value={status?.progress?.current || 0} max={status?.progress?.total || 100} className="mt-1.5 w-32" />
        )}
        {doc.processing_error && <p className="text-xs text-nogo mt-1 truncate">{doc.processing_error}</p>}
      </div>
      <button onClick={handleDelete} className="p-1.5 rounded text-smoke-400 hover:text-nogo hover:bg-nogo/10 transition-colors">
        <Trash2Icon size={13} />
      </button>
    </div>
  )
}

// ── Requirements tab ──────────────────────────────────────────────
function RequirementsTab({ oppId }: { oppId: string }) {
  const { data: reqs = [], isLoading } = useQuery<any[]>({
    queryKey: ['requirements', oppId],
    queryFn: () => opportunitiesApi.getRequirements(oppId).then(r => r.data),
  })
  if (isLoading) return <div className="flex items-center justify-center h-32"><Spinner /></div>
  if (reqs.length === 0) return (
    <div className="card p-8 text-center">
      <p className="text-sm text-smoke-500">No requirements extracted yet. Upload a requirements Excel file in the Documents tab.</p>
    </div>
  )
  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-sand-50 border-b border-sand-200">
            <th className="text-left px-4 py-3 text-xs font-semibold text-smoke-500">ID</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-smoke-500">Description</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-smoke-500 hidden md:table-cell">Category</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-smoke-500">Priority</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sand-100">
          {reqs.map(req => (
            <tr key={req.id} className="hover:bg-sand-50 transition-colors">
              <td className="px-4 py-3"><span className="font-mono text-xs text-smoke-500">{req.req_id || '—'}</span></td>
              <td className="px-4 py-3 max-w-xl"><p className="text-sm text-ink-500">{req.description}</p></td>
              <td className="px-4 py-3 hidden md:table-cell"><span className="text-xs text-smoke-500">{req.category || '—'}</span></td>
              <td className="px-4 py-3">
                <span className={cn('badge text-xs',
                  req.priority === 'High' ? 'text-nogo bg-nogo/10' :
                  req.priority === 'Medium' ? 'text-caution bg-caution/10' : 'text-smoke-500 bg-sand-200'
                )}>{req.priority || 'Medium'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── CFAV tab (Stage 3) ────────────────────────────────────────────
function CFAVTab({ opp }: { opp: Opportunity }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { register, handleSubmit, watch, formState: { isSubmitting } } = useForm({
    defaultValues: {
      complexity_score: opp.complexity_score ?? 50,
      feasibility_score: opp.feasibility_score ?? 50,
      alignment_score: opp.alignment_score ?? 50,
      value_score: opp.value_score ?? 50,
    },
  })

  const gc = GONOGO_CONFIG[opp.go_no_go_status as GoNoGoStatus]

  const cfavMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => opportunitiesApi.updateCFAV(opp.id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunity', opp.id] }),
  })

  const proceedMutation = useMutation({
    mutationFn: () => opportunitiesApi.confirmProceed(opp.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['opportunity', opp.id] }),
  })

  const dims = [
    { key: 'complexity_score', label: 'Complexity', weight: '20%', hint: 'How complex is this bid to respond to? Higher = more complex' },
    { key: 'feasibility_score', label: 'Feasibility', weight: '30%', hint: 'Can we genuinely deliver what this RFP asks for? Higher = more feasible' },
    { key: 'alignment_score', label: 'Alignment', weight: '30%', hint: 'How well does our offering match the client\'s stated need? Higher = stronger alignment' },
    { key: 'value_score', label: 'Value', weight: '20%', hint: 'What is the strategic or commercial value of this bid? Higher = more valuable' },
  ]

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <form onSubmit={handleSubmit(d => cfavMutation.mutate(d as any))}>
          <div className="card p-6 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-ink-500 mb-1">CFAV Preliminary Scoring</h3>
              <p className="text-xs text-smoke-500">Score each dimension 0–100. The aggregate determines the Go/No-Go recommendation.</p>
            </div>
            {dims.map(d => {
              const val = watch(d.key as any) as number
              return (
                <div key={d.key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium text-ink-500">{d.label}</span>
                      <span className="ml-2 text-2xs text-smoke-400 bg-sand-200 rounded px-1.5 py-0.5">{d.weight}</span>
                    </div>
                    <CFAVScore score={val} size="sm" />
                  </div>
                  <input type="range" min={0} max={100} step={5}
                    {...register(d.key as any, { valueAsNumber: true })}
                    className="w-full h-2 bg-sand-200 rounded-full appearance-none cursor-pointer accent-clay-400" />
                  <p className="text-xs text-smoke-400">{d.hint}</p>
                </div>
              )
            })}
          </div>
          <div className="flex justify-end mt-4">
            <Button type="submit" variant="primary" loading={isSubmitting || cfavMutation.isPending} icon={<BarChart2Icon size={14} />}>
              Calculate Go/No-Go
            </Button>
          </div>
        </form>
      </div>

      <div className="space-y-4">
        {/* Go/No-Go result */}
        <div className={cn('card p-5 border-2', gc?.bg, opp.go_no_go_status !== 'pending' ? '' : 'border-sand-200')}>
          <p className="text-xs font-semibold text-smoke-500 uppercase tracking-wide mb-2">Go/No-Go Status</p>
          <div className="flex items-center gap-3 mb-3">
            <div className={cn('text-2xl font-bold', gc?.color)}>{gc?.icon}</div>
            <div>
              <p className={cn('text-lg font-semibold', gc?.color)}>{gc?.label}</p>
              {opp.cfav_score !== null && (
                <p className="text-xs text-smoke-500">Aggregate score: {Math.round(opp.cfav_score)}/100</p>
              )}
            </div>
          </div>
          {opp.go_no_go_status === 'go' && (
            <Button variant="primary" loading={proceedMutation.isPending}
              onClick={async () => {
                await proceedMutation.mutateAsync()
                navigate(`/opportunities/${opp.id}/generate`)
              }} className="w-full">
              <CheckCircle2Icon size={14} /> Confirm — proceed to generation
            </Button>
          )}
          {opp.status === 'under_review' && opp.go_no_go_status === 'go' && (
            <Button variant="secondary" onClick={() => navigate(`/opportunities/${opp.id}/generate`)} className="w-full mt-2">
              Go to Generation →
            </Button>
          )}
          {opp.go_no_go_status === 'pursue_with_caveats' && (
            <Button variant="secondary" loading={proceedMutation.isPending}
              onClick={() => proceedMutation.mutate()} className="w-full">
              Proceed with caveats (sponsor override required)
            </Button>
          )}
          {opp.go_no_go_status === 'no_go' && (
            <div className="rounded-lg bg-nogo-light p-3 mt-2">
              <p className="text-xs text-nogo">Score below threshold. This bid requires sponsor sign-off to proceed.</p>
            </div>
          )}
        </div>

        <div className="card p-5">
          <p className="text-xs font-semibold text-smoke-500 uppercase tracking-wide mb-3">Scoring thresholds</p>
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-go" /><span className="text-go font-medium">Go</span><span className="text-smoke-500 ml-auto">≥ 65</span></div>
            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-caution" /><span className="text-caution font-medium">Pursue with caveats</span><span className="text-smoke-500 ml-auto">45–64</span></div>
            <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-nogo" /><span className="text-nogo font-medium">No-go recommended</span><span className="text-smoke-500 ml-auto">&lt; 45</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Activity tab ──────────────────────────────────────────────────
function ActivityTab({ oppId }: { oppId: string }) {
  const { data: logs = [] } = useQuery<any[]>({
    queryKey: ['activity', oppId],
    queryFn: () => opportunitiesApi.getActivity(oppId).then(r => r.data),
    refetchInterval: 30_000,
  })
  if (logs.length === 0) return <div className="card p-8 text-center"><p className="text-sm text-smoke-500">No activity yet.</p></div>
  return (
    <div className="card overflow-hidden">
      <div className="divide-y divide-sand-100">
        {logs.map(log => (
          <div key={log.id} className="flex gap-3 px-5 py-3.5">
            <div className="w-6 h-6 rounded-full bg-sand-200 flex items-center justify-center flex-shrink-0 mt-0.5">
              <ActivityIcon size={11} className="text-smoke-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-ink-500">{log.detail || log.action}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-smoke-500">{log.user_name}</span>
                <span className="text-xs text-smoke-400">·</span>
                <span className="text-xs text-smoke-400">{timeAgo(log.created_at)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Knowledge Base tab ────────────────────────────────────────────
function KnowledgeTab({ opp }: { opp: Opportunity }) {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [promoting, setPromoting] = useState<string | null>(null)
  const [promoteMsg, setPromoteMsg] = useState('')

  // Auto-search when tab opens using opportunity context
  const autoQuery = [
    opp.name,
    opp.industry_vertical,
    opp.sub_domain ? INDUSTRY_SUBDOMAINS[opp.industry_vertical]?.find(s => s.value === opp.sub_domain)?.label : null,
    opp.solution_type
  ].filter(Boolean).join(' ')

  const { data: searchResults, isLoading: searching, refetch: doSearch } = useQuery({
    queryKey: ['kb-search', opp.id, searchQuery || autoQuery],
    queryFn: () => documentsApi.searchKB(searchQuery || autoQuery, 6).then(r => r.data),
    enabled: true,
    staleTime: 60_000,
  })

  // Documents from this opportunity eligible for promotion
  const { data: oppDocs = [] } = useQuery<Document[]>({
    queryKey: ['opp-docs', opp.id],
    queryFn: () => documentsApi.listByOpportunity(opp.id).then(r => r.data),
  })

  const completedDocs = oppDocs.filter((d: Document) => d.status === 'completed')

  const handleSearch = () => {
    if (query.trim()) setSearchQuery(query.trim())
    else setSearchQuery('')
    doSearch()
  }

  const handlePromote = async (doc: Document) => {
    setPromoting(doc.id)
    setPromoteMsg('')
    try {
      const res = await documentsApi.promoteToKB({
        document_id: doc.id,
        outcome: opp.capture_result || undefined,
        industry_vertical: opp.industry_vertical,
        solution_type: opp.solution_type,
      })
      setPromoteMsg(res.data.message)
      qc.invalidateQueries({ queryKey: ['opp-docs', opp.id] })
      qc.invalidateQueries({ queryKey: ['kb-search'] })
    } catch (e: any) {
      setPromoteMsg(e?.response?.data?.detail || 'Promotion failed.')
    } finally {
      setPromoting(null)
    }
  }

  const results = searchResults?.results || []
  const hasKB = searchResults?.total > 0

  return (
    <div className="grid lg:grid-cols-3 gap-6">

      {/* Left — Search results */}
      <div className="lg:col-span-2 space-y-4">

        {/* Search box */}
        <div className="card p-4">
          <p className="text-xs font-semibold text-smoke-500 uppercase tracking-wide mb-3">
            Search knowledge base
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-smoke-400" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder="Search past proposals, case studies..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:ring-2 focus:ring-clay-400/20 focus:outline-none"
              />
            </div>
            <button
              onClick={handleSearch}
              className="px-3 py-2 bg-clay-400 text-white text-sm rounded-lg hover:bg-clay-500 transition-colors"
            >
              Search
            </button>
          </div>
          {!searchQuery && (
            <p className="text-xs text-smoke-400 mt-2">
              Showing auto-results for: <span className="italic">{autoQuery}</span>
            </p>
          )}
        </div>

        {/* Results */}
        {searching ? (
          <div className="card p-8 flex items-center justify-center">
            <Spinner className="w-5 h-5 text-clay-400" />
          </div>
        ) : !hasKB ? (
          <div className="card p-8 text-center">
            <BookOpenIcon size={28} className="text-sand-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-ink-500 mb-1">No matching documents found</p>
            <p className="text-xs text-smoke-500">
              Upload past proposals and case studies to the Knowledge Base to enable semantic search.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-smoke-500 px-1">
              {results.length} relevant document{results.length !== 1 ? 's' : ''} found
            </p>
            {results.map((r: any) => (
              <div key={r.chunk_id} className="card p-4 hover:border-clay-200 transition-colors">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <FileTextIcon size={14} className="text-clay-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-500 truncate">{r.document_name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {r.industry && (
                          <span className="text-xs text-smoke-500">{INDUSTRY_LABELS[r.industry] || r.industry}</span>
                        )}
                        {r.outcome && (
                          <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-full',
                            r.outcome === 'won'   ? 'bg-go-light text-go' :
                            r.outcome === 'lost'  ? 'bg-nogo/10 text-nogo' :
                            'bg-sand-200 text-smoke-500')}>
                            {r.outcome}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div className="text-right">
                      <p className="text-xs font-semibold text-clay-500">{Math.round(r.score * 100)}%</p>
                      <p className="text-xs text-smoke-400">match</p>
                    </div>
                    {/* Relevance bar */}
                    <div className="w-1.5 h-10 bg-sand-200 rounded-full overflow-hidden">
                      <div
                        className="w-full bg-clay-400 rounded-full transition-all"
                        style={{ height: `${r.score * 100}%`, marginTop: `${(1 - r.score) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
                {r.excerpt && (
                  <p className="text-xs text-smoke-500 leading-relaxed line-clamp-3 mt-2 border-t border-sand-100 pt-2">
                    {r.excerpt}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right panel — Promote to KB */}
      <div className="space-y-4">

        {/* Promote to KB card */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <ZapIcon size={14} className="text-clay-400" />
            <p className="text-sm font-semibold text-ink-500">Promote to Knowledge Base</p>
          </div>
          <p className="text-xs text-smoke-500 mb-4">
            Add completed bid documents from this opportunity to the global KB for reuse in future bids.
          </p>

          {promoteMsg && (
            <div className="rounded-lg bg-go-light border border-go/20 p-2.5 mb-3">
              <p className="text-xs text-go">{promoteMsg}</p>
            </div>
          )}

          {completedDocs.length === 0 ? (
            <div className="rounded-lg bg-sand-100 p-3 text-center">
              <p className="text-xs text-smoke-500">No completed documents to promote yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {completedDocs.map((doc: Document) => (
                <div key={doc.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-sand-50 border border-sand-200">
                  <FileTextIcon size={13} className="text-smoke-400 flex-shrink-0" />
                  <p className="text-xs text-ink-500 truncate flex-1">{doc.original_filename}</p>
                  <button
                    onClick={() => handlePromote(doc)}
                    disabled={promoting === doc.id}
                    className="flex-shrink-0 flex items-center gap-1 text-xs text-clay-500 hover:text-clay-700 disabled:opacity-50 transition-colors"
                  >
                    {promoting === doc.id
                      ? <Spinner className="w-3 h-3" />
                      : <><PlusIcon size={12} /> Add</>
                    }
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tips card */}
        <div className="card p-5 bg-clay-50 border-clay-100">
          <p className="text-xs font-semibold text-clay-600 mb-2">How it works</p>
          <div className="space-y-2 text-xs text-clay-600">
            <div className="flex items-start gap-2">
              <ArrowRightIcon size={11} className="flex-shrink-0 mt-0.5" />
              <p>Results are ranked by semantic similarity to this opportunity's profile</p>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRightIcon size={11} className="flex-shrink-0 mt-0.5" />
              <p>The AI uses these documents during bid generation to ground its responses</p>
            </div>
            <div className="flex items-start gap-2">
              <ArrowRightIcon size={11} className="flex-shrink-0 mt-0.5" />
              <p>Promoting won bids improves future retrieval accuracy over time</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Bid Team tab ──────────────────────────────────────────────────
const BID_ROLES = [
  { value: 'bid_lead',           label: 'Bid Lead' },
  { value: 'solution_architect', label: 'Solution Architect' },
  { value: 'commercial_lead',    label: 'Commercial Lead' },
  { value: 'sme',                label: 'Subject Matter Expert' },
  { value: 'reviewer',           label: 'Reviewer' },
  { value: 'exec_sponsor',       label: 'Executive Sponsor' },
  { value: 'delivery_lead',      label: 'Delivery Lead' },
  { value: 'other',              label: 'Other' },
]

const ROLE_COLOURS: Record<string, string> = {
  bid_lead:           'bg-clay-100 text-clay-600',
  solution_architect: 'bg-info/10 text-info',
  commercial_lead:    'bg-caution/10 text-caution',
  sme:                'bg-go-light text-go',
  reviewer:           'bg-sand-200 text-smoke-600',
  exec_sponsor:       'bg-nogo/10 text-nogo',
  delivery_lead:      'bg-go-light text-go',
  other:              'bg-sand-200 text-smoke-500',
}

function BidTeamTab({ opp }: { opp: Opportunity }) {
  const qc = useQueryClient()

  // Check if AD is configured and verified
  const { data: adCfg } = useQuery({
    queryKey: ['integration', 'azure_ad'],
    queryFn: () => integrationsApi.get('azure_ad').then(r => r.data),
  })
  const adAvailable = adCfg?.enabled && adCfg?.verified

  // Bid team members
  const { data: teamData, isLoading } = useQuery({
    queryKey: ['bid-team', opp.id],
    queryFn: () => bidTeamApi.list(opp.id).then(r => r.data),
  })
  const members: any[] = teamData?.members || []

  // Add person form state
  const [showAdd, setShowAdd]         = useState(false)
  const [adSearch, setAdSearch]       = useState('')
  const [adResults, setAdResults]     = useState<any[]>([])
  const [adSearching, setAdSearching] = useState(false)
  const [selected, setSelected]       = useState<any | null>(null)
  const [manualName, setManualName]   = useState('')
  const [manualEmail, setManualEmail] = useState('')
  const [role, setRole]               = useState('other')
  const [adding, setAdding]           = useState(false)
  const [msg, setMsg]                 = useState('')

  // AD search with debounce
  React.useEffect(() => {
    if (!adAvailable || adSearch.length < 2) { setAdResults([]); return }
    const t = setTimeout(async () => {
      setAdSearching(true)
      try {
        const res = await integrationsApi.searchAD(adSearch)
        setAdResults(res.data.results || [])
      } catch { setAdResults([]) }
      finally { setAdSearching(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [adSearch, adAvailable])

  const handleAdd = async () => {
    setAdding(true); setMsg('')
    try {
      const payload: any = { opportunity_id: opp.id, role }
      if (adAvailable && selected) {
        payload.display_name = selected.display_name
        payload.email        = selected.email
        payload.job_title    = selected.job_title
        payload.department   = selected.department
        payload.ad_object_id = selected.ad_object_id
      } else {
        if (!manualName.trim()) { setMsg('Please enter a name.'); setAdding(false); return }
        payload.display_name = manualName.trim()
        payload.email        = manualEmail.trim() || undefined
      }
      await bidTeamApi.add(payload)
      qc.invalidateQueries({ queryKey: ['bid-team', opp.id] })
      setShowAdd(false)
      setSelected(null); setAdSearch(''); setManualName(''); setManualEmail('')
      setRole('other')
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || 'Failed to add member.')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (memberId: string) => {
    if (!confirm('Remove this person from the bid team?')) return
    try {
      await bidTeamApi.remove(memberId)
      qc.invalidateQueries({ queryKey: ['bid-team', opp.id] })
    } catch {}
  }

  const handleRoleChange = async (memberId: string, newRole: string) => {
    try {
      await bidTeamApi.update(memberId, { role: newRole })
      qc.invalidateQueries({ queryKey: ['bid-team', opp.id] })
    } catch {}
  }

  return (
    <div className="grid lg:grid-cols-3 gap-6">

      {/* Members list */}
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-500">
            {members.length} {members.length === 1 ? 'person' : 'people'} on this bid
          </p>
          <button onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-clay-400 text-white text-xs rounded-lg hover:bg-clay-500 transition-colors">
            <PlusIcon size={13} /> Add person
          </button>
        </div>

        {/* Add person form */}
        {showAdd && (
          <div className="card p-4 border-clay-200 bg-clay-50/30 space-y-3">
            <p className="text-xs font-semibold text-ink-500">
              {adAvailable ? 'Search Azure AD' : 'Add team member'}
              {adAvailable
                ? <span className="ml-2 text-go font-normal">● AD connected</span>
                : <span className="ml-2 text-smoke-400 font-normal">— manual entry</span>
              }
            </p>

            {adAvailable ? (
              <div className="space-y-2">
                <div className="relative">
                  <SearchIcon size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-smoke-400" />
                  <input
                    value={adSearch}
                    onChange={e => { setAdSearch(e.target.value); setSelected(null) }}
                    placeholder="Search by name or email..."
                    className="w-full pl-8 pr-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none"
                    autoFocus
                  />
                </div>
                {adSearching && <p className="text-xs text-smoke-400">Searching...</p>}
                {adResults.length > 0 && !selected && (
                  <div className="border border-sand-200 rounded-lg overflow-hidden shadow-warm-sm">
                    {adResults.map(u => (
                      <button key={u.ad_object_id} onClick={() => { setSelected(u); setAdSearch(u.display_name); setAdResults([]) }}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-sand-50 transition-colors text-left border-b border-sand-100 last:border-0">
                        <div className="w-7 h-7 rounded-full bg-clay-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-xs font-semibold text-clay-600">
                            {u.display_name?.split(' ').map((n: string) => n[0]).join('').slice(0,2)}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-500 truncate">{u.display_name}</p>
                          <p className="text-xs text-smoke-500 truncate">{u.email} {u.job_title && `· ${u.job_title}`}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {selected && (
                  <div className="rounded-lg bg-go-light border border-go/20 p-2.5 flex items-center gap-2">
                    <CheckCircle2Icon size={13} className="text-go" />
                    <p className="text-xs text-go font-medium">{selected.display_name} selected</p>
                    <button onClick={() => { setSelected(null); setAdSearch('') }}
                      className="ml-auto text-xs text-smoke-400 hover:text-nogo">✕</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <input value={manualName} onChange={e => setManualName(e.target.value)}
                  placeholder="Full name *"
                  className="px-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
                <input value={manualEmail} onChange={e => setManualEmail(e.target.value)}
                  placeholder="Email (optional)"
                  className="px-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
              </div>
            )}

            <div className="flex items-center gap-2">
              <select value={role} onChange={e => setRole(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none bg-white">
                {BID_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <button onClick={handleAdd} disabled={adding}
                className="px-3 py-2 bg-clay-400 text-white text-sm rounded-lg hover:bg-clay-500 disabled:opacity-50 transition-colors">
                {adding ? 'Adding...' : 'Add'}
              </button>
              <button onClick={() => setShowAdd(false)}
                className="px-3 py-2 bg-sand-200 text-smoke-600 text-sm rounded-lg hover:bg-sand-300 transition-colors">
                Cancel
              </button>
            </div>
            {msg && <p className="text-xs text-nogo">{msg}</p>}
          </div>
        )}

        {/* Team list */}
        {isLoading ? (
          <div className="card p-8 flex justify-center"><Spinner /></div>
        ) : members.length === 0 ? (
          <div className="card p-8 text-center">
            <UsersIcon size={28} className="text-sand-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-ink-500 mb-1">No team members yet</p>
            <p className="text-xs text-smoke-500">Add the people involved in responding to this bid.</p>
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="divide-y divide-sand-100">
              {members.map((m: any) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-clay-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-clay-600">
                      {m.display_name.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-500">{m.display_name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {m.email && <p className="text-xs text-smoke-400 truncate">{m.email}</p>}
                      {m.job_title && <p className="text-xs text-smoke-400">· {m.job_title}</p>}
                      {m.department && <p className="text-xs text-smoke-400">· {m.department}</p>}
                    </div>
                  </div>
                  <select
                    value={m.role}
                    onChange={e => handleRoleChange(m.id, e.target.value)}
                    className={cn('text-xs px-2 py-1 rounded-full border-0 font-medium cursor-pointer focus:outline-none',
                      ROLE_COLOURS[m.role] || 'bg-sand-200 text-smoke-500')}>
                    {BID_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                  <button onClick={() => handleRemove(m.id)}
                    className="text-smoke-300 hover:text-nogo transition-colors ml-1 flex-shrink-0">
                    <Trash2Icon size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right panel — summary */}
      <div className="space-y-4">
        <div className="card p-5">
          <p className="text-xs font-semibold text-smoke-500 uppercase tracking-wide mb-3">Team summary</p>
          {members.length === 0 ? (
            <p className="text-xs text-smoke-400">No members yet.</p>
          ) : (
            <div className="space-y-2">
              {BID_ROLES.filter(r => members.some((m: any) => m.role === r.value)).map(r => {
                const roleMembers = members.filter((m: any) => m.role === r.value)
                return (
                  <div key={r.value}>
                    <p className="text-xs text-smoke-500 mb-1">{r.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {roleMembers.map((m: any) => (
                        <span key={m.id} className={cn('text-xs px-2 py-0.5 rounded-full font-medium',
                          ROLE_COLOURS[m.role] || 'bg-sand-200 text-smoke-500')}>
                          {m.display_name.split(' ')[0]}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="card p-5 bg-clay-50 border-clay-100">
          <p className="text-xs font-semibold text-clay-600 mb-2">
            {adAvailable ? '● Azure AD connected' : 'Manual entry mode'}
          </p>
          <p className="text-xs text-clay-600">
            {adAvailable
              ? 'People search is active. Type a name to search your organisation directory.'
              : 'Configure Azure AD in Settings → Integrations to enable directory search.'}
          </p>
        </div>
      </div>

    </div>
  )
}
