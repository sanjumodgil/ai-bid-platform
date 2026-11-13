// ── Knowledge Base Page ───────────────────────────────────────────
import React, { useState, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { documentsApi, kbApi, integrationsApi, setupApi, usersApi, useAuthStore, opportunitiesApi, dashboardApi } from '../lib/api'
import { Button, Spinner, EmptyState, SectionHeader, ProgressBar } from '../components/ui'
import { UploadIcon, BookOpenIcon, Trash2Icon, RefreshCwIcon, FileTextIcon, UsersIcon, UserIcon, ChevronRightIcon, ChevronDownIcon, PlusIcon, SearchIcon, AlertCircleIcon, CheckCircle2Icon, ServerIcon, ZapIcon, ActivityIcon } from '../components/ui/icons'
import { formatFileSize, formatDate, timeAgo, DOC_STATUS_CONFIG, INDUSTRY_LABELS, INDUSTRY_SUBDOMAINS, cn } from '../lib/utils'
import type { Document, DocumentStatus } from '../types'

export function KnowledgeBasePage() {
  const [dragging, setDragging]           = useState(false)
  const [uploading, setUploading]         = useState(false)
  const [expandedDoc, setExpandedDoc]     = useState<string | null>(null)
  const [uploadMode, setUploadMode]       = useState<'opportunity' | 'standalone'>('opportunity')
  const [linkedOppId, setLinkedOppId]     = useState('')
  const [metadata, setMetadata] = useState({
    display_name: '', owning_team: '',
    industry_vertical: '', sub_domain: '', outcome: '', content_type_tag: '',
  })
  const [uploadError, setUploadError]     = useState('')
  const qc = useQueryClient()

  const { data: docs = [], isLoading, refetch } = useQuery<Document[]>({
    queryKey: ['kb-documents'],
    queryFn: () => documentsApi.listKB().then(r => r.data),
    refetchInterval: 8_000,
  })

  // Opportunities for linkage
  const { data: allOpps = [] } = useQuery<any[]>({
    queryKey: ['opportunities-mini'],
    queryFn: () => opportunitiesApi.list().then(r => r.data),
    staleTime: 60_000,
  })
  const oppMap = Object.fromEntries(allOpps.map((o: any) => [o.id, o]))

  const processing = docs.filter(d => ['processing', 'uploading'].includes(d.status))

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    setUploadError('')
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('doc_type', 'past_proposal')

      if (uploadMode === 'opportunity' && linkedOppId) {
        // Linked to opportunity — inherit its metadata
        const opp = oppMap[linkedOppId]
        fd.append('opportunity_id', linkedOppId)
        if (opp) {
          if (opp.industry_vertical) fd.append('industry_vertical', opp.industry_vertical)
          if (opp.sub_domain)        fd.append('sub_domain', opp.sub_domain)
          if (opp.solution_type)     fd.append('solution_type', opp.solution_type)
        }
      } else {
        // Standalone — use manually entered metadata
        Object.entries(metadata).forEach(([k, v]) => {
          if (v && typeof v === 'string') fd.append(k, v)
        })
      }

      if (metadata.display_name) fd.append('display_name', metadata.display_name)
      if (metadata.owning_team)  fd.append('owning_team', metadata.owning_team)

      try {
        await documentsApi.upload(fd)
      } catch (e: any) {
        const detail = e?.response?.data?.detail
        setUploadError(typeof detail === 'string' ? detail : `Upload failed: ${e?.message || 'Unknown error'}`)
      }
    }
    setUploading(false)
    refetch()
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files)
  }, [metadata])

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <SectionHeader
        title="Knowledge Base"
        description="Upload past proposals to build the RAG knowledge base. These documents power AI-generated responses."
      />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Upload panel */}
        <div className="space-y-4">
          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-ink-500">Upload to knowledge base</h3>

            {/* Mode toggle */}
            <div className="flex rounded-lg border border-sand-300 overflow-hidden text-xs">
              <button type="button"
                onClick={() => setUploadMode('opportunity')}
                className={cn('flex-1 py-1.5 font-medium transition-colors',
                  uploadMode === 'opportunity' ? 'bg-clay-400 text-white' : 'bg-white text-smoke-500 hover:bg-sand-50')}>
                📎 Link to opportunity
              </button>
              <button type="button"
                onClick={() => setUploadMode('standalone')}
                className={cn('flex-1 py-1.5 font-medium transition-colors',
                  uploadMode === 'standalone' ? 'bg-clay-400 text-white' : 'bg-white text-smoke-500 hover:bg-sand-50')}>
                📁 Standalone
              </button>
            </div>

            {/* Opportunity picker */}
            {uploadMode === 'opportunity' && (
              <div>
                <label className="block text-xs font-medium text-smoke-500 mb-1">
                  Select opportunity <span className="text-nogo">*</span>
                </label>
                <select value={linkedOppId}
                  onChange={e => setLinkedOppId(e.target.value)}
                  className="w-full text-sm rounded-lg border border-sand-300 bg-white px-3 py-1.5 focus:border-clay-400 focus:outline-none">
                  <option value="">— select an opportunity —</option>
                  {allOpps.map((o: any) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.client_name})
                    </option>
                  ))}
                </select>
                {linkedOppId && oppMap[linkedOppId] && (
                  <div className="mt-2 rounded-lg bg-sand-100 p-2.5 text-xs text-smoke-600 space-y-0.5">
                    <p>↳ Industry: <span className="font-medium">{INDUSTRY_LABELS[oppMap[linkedOppId].industry_vertical] || oppMap[linkedOppId].industry_vertical}
                      {oppMap[linkedOppId].sub_domain && ` › ${INDUSTRY_SUBDOMAINS[oppMap[linkedOppId].industry_vertical]?.find((s: any) => s.value === oppMap[linkedOppId].sub_domain)?.label || oppMap[linkedOppId].sub_domain}`}
                    </span></p>
                    {oppMap[linkedOppId].solution_type && <p>↳ Solution: <span className="font-medium">{oppMap[linkedOppId].solution_type}</span></p>}
                    <p className="text-smoke-400 mt-1">Industry and sub-domain will be inherited automatically.</p>
                  </div>
                )}
              </div>
            )}

            {/* Standalone metadata */}
            {uploadMode === 'standalone' && (
              <>
                {/* Industry */}
                <div>
                  <label className="block text-xs font-medium text-smoke-500 mb-1">Industry</label>
                  <select value={metadata.industry_vertical}
                    onChange={e => setMetadata(m => ({ ...m, industry_vertical: e.target.value, sub_domain: '' }))}
                    className="w-full text-sm rounded-lg border border-sand-300 bg-white px-3 py-1.5 focus:border-clay-400 focus:outline-none">
                    <option value="">Any</option>
                    {Object.entries(INDUSTRY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                {/* Sub-domain */}
                {metadata.industry_vertical && INDUSTRY_SUBDOMAINS[metadata.industry_vertical]?.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-smoke-500 mb-1">Sub-domain</label>
                    <select value={metadata.sub_domain}
                      onChange={e => setMetadata(m => ({ ...m, sub_domain: e.target.value }))}
                      className="w-full text-sm rounded-lg border border-sand-300 bg-white px-3 py-1.5 focus:border-clay-400 focus:outline-none">
                      <option value="">Select sub-domain (optional)</option>
                      {INDUSTRY_SUBDOMAINS[metadata.industry_vertical].map(s => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Outcome */}
                <div>
                  <label className="block text-xs font-medium text-smoke-500 mb-1">Outcome</label>
                  <select value={metadata.outcome}
                    onChange={e => setMetadata(m => ({ ...m, outcome: e.target.value }))}
                    className="w-full text-sm rounded-lg border border-sand-300 bg-white px-3 py-1.5 focus:border-clay-400 focus:outline-none">
                    <option value="">Unknown</option>
                    <option value="won">Won</option>
                    <option value="lost">Lost</option>
                    <option value="pipeline">Pipeline</option>
                    <option value="internal">Internal</option>
                  </select>
                </div>
                {/* Content type */}
                <div>
                  <label className="block text-xs font-medium text-smoke-500 mb-1">Content type</label>
                  <select value={metadata.content_type_tag}
                    onChange={e => setMetadata(m => ({ ...m, content_type_tag: e.target.value }))}
                    className="w-full text-sm rounded-lg border border-sand-300 bg-white px-3 py-1.5 focus:border-clay-400 focus:outline-none">
                    <option value="">General</option>
                    <option value="case_study">Case Study</option>
                    <option value="capability">Capability Statement</option>
                    <option value="compliance">Compliance Certificate</option>
                    <option value="solution_blueprint">Solution Blueprint</option>
                  </select>
                </div>
              </>
            )}

            {/* Common fields — always shown */}
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Document name <span className="text-smoke-400 font-normal">(optional)</span></label>
              <input type="text" value={metadata.display_name}
                onChange={e => setMetadata(m => ({ ...m, display_name: e.target.value }))}
                placeholder="e.g. [Company] NHS Cloud Proposal 2024"
                className="w-full text-sm rounded-lg border border-sand-300 bg-white px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Owning team / author <span className="text-smoke-400 font-normal">(optional)</span></label>
              <input type="text" value={metadata.owning_team}
                onChange={e => setMetadata(m => ({ ...m, owning_team: e.target.value }))}
                placeholder="e.g. NHS Practice, Retail CoE, John Smith"
                className="w-full text-sm rounded-lg border border-sand-300 bg-white px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
            </div>

            {/* Upload error */}
            {uploadError && (
              <div className="rounded-lg bg-nogo/10 border border-nogo/20 p-2.5">
                <p className="text-xs text-nogo">{uploadError}</p>
              </div>
            )}

            {/* Drop zone */}
            <div
              className={cn('drop-zone', dragging && 'dragging')}
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onClick={() => document.getElementById('kb-file-input')?.click()}
            >
              <input id="kb-file-input" type="file" className="hidden" accept=".pdf,.docx,.doc" multiple
                onChange={e => handleFiles(e.target.files)} />
              <UploadIcon size={20} className={cn('mx-auto mb-2', dragging ? 'text-clay-400' : 'text-smoke-300')} />
              <p className="text-sm font-medium text-ink-500">Drop files here</p>
              <p className="text-xs text-smoke-500 mt-1">PDF or DOCX</p>
              {uploading && <p className="text-xs text-clay-500 mt-2 flex items-center gap-1 justify-center"><RefreshCwIcon size={11} className="animate-spin" /> Uploading...</p>}
            </div>
          </div>

          {/* Stats */}
          <div className="card p-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-smoke-500">Documents</span><span className="font-medium text-ink-500">{docs.length}</span></div>
              <div className="flex justify-between"><span className="text-smoke-500">Processing</span><span className="font-medium text-caution">{processing.length}</span></div>
              <div className="flex justify-between"><span className="text-smoke-500">Completed</span><span className="font-medium text-go">{docs.filter(d => d.status === 'completed').length}</span></div>
            </div>
          </div>
        </div>

        {/* Document list */}
        <div className="lg:col-span-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-32"><Spinner /></div>
          ) : docs.length === 0 ? (
            <EmptyState icon={<BookOpenIcon size={36} />} title="Knowledge base is empty"
              description="Upload past proposals to enable AI-powered retrieval. The platform learns from each document you add." />
          ) : (
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-sand-100 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-500">Documents ({docs.length})</h3>
                {processing.length > 0 && (
                  <span className="text-xs text-caution flex items-center gap-1"><RefreshCwIcon size={11} className="animate-spin" /> {processing.length} indexing</span>
                )}
              </div>
              <div className="divide-y divide-sand-100">
                {docs.map(doc => {
                  const sc = DOC_STATUS_CONFIG[doc.status as DocumentStatus]
                  const isExpanded = expandedDoc === doc.id
                  return (
                    <div key={doc.id} className="border-b border-sand-100 last:border-0">
                      {/* Document row */}
                      <div
                        className="flex items-center gap-3 px-4 py-3 hover:bg-sand-50 transition-colors cursor-pointer"
                        onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}
                      >
                        <FileTextIcon size={15} className="text-smoke-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-ink-500 truncate font-medium">
                            {doc.display_name || doc.original_filename}
                          </p>
                          {doc.display_name && (
                            <p className="text-xs text-smoke-400 truncate">{doc.original_filename}</p>
                          )}
                          <div className="flex gap-2 mt-0.5 flex-wrap items-center">
                            <span className="text-xs text-smoke-400">{formatFileSize(doc.file_size_bytes)}</span>
                            {doc.chunk_count > 0 && <span className="text-xs text-smoke-400">{doc.chunk_count} chunks</span>}
                            {doc.industry_vertical && (
                              <span className="text-xs text-smoke-400">
                                {INDUSTRY_LABELS[doc.industry_vertical] || doc.industry_vertical}
                                {doc.sub_domain && ` › ${INDUSTRY_SUBDOMAINS[doc.industry_vertical]?.find((s: any) => s.value === doc.sub_domain)?.label || doc.sub_domain}`}
                              </span>
                            )}
                            {doc.outcome && <span className={cn('text-xs font-medium', doc.outcome === 'won' ? 'text-go' : doc.outcome === 'lost' ? 'text-nogo' : 'text-smoke-500')}>{doc.outcome}</span>}
                            <span className={cn('text-xs font-medium', sc?.color)}>{sc?.label}</span>
                          </div>
                          <div className="flex gap-2 mt-0.5 flex-wrap items-center">
                            {doc.owning_team && (
                              <span className="text-xs text-clay-500 flex items-center gap-1">
                                <UsersIcon size={10} /> {doc.owning_team}
                              </span>
                            )}
                            {doc.uploaded_by_name && (
                              <span className="text-xs text-smoke-400 flex items-center gap-1">
                                <UserIcon size={10} /> {doc.uploaded_by_name}
                              </span>
                            )}
                            {doc.opportunity_id && oppMap[doc.opportunity_id] && (
                              <span className="text-xs text-clay-500 flex items-center gap-1">
                                🔗 {oppMap[doc.opportunity_id].name}
                              </span>
                            )}
                            {doc.created_at && (
                              <span className="text-xs text-smoke-400">{timeAgo(doc.created_at)}</span>
                            )}
                          </div>
                          {doc.status === 'processing' && <ProgressBar value={50} className="mt-1.5 w-24" />}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isExpanded
                            ? <ChevronDownIcon size={14} className="text-smoke-400" />
                            : <ChevronRightIcon size={14} className="text-smoke-400" />
                          }
                          <button
                            onClick={e => { e.stopPropagation(); if (confirm('Remove from knowledge base?')) { documentsApi.delete(doc.id); refetch() } }}
                            className="p-1.5 text-smoke-400 hover:text-nogo hover:bg-nogo/10 rounded transition-colors ml-1">
                            <Trash2Icon size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Expanded panel — contributors + lessons */}
                      {isExpanded && <DocDetailPanel doc={doc} />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Settings Page ─────────────────────────────────────────────────
import { useQuery as useQ } from '@tanstack/react-query'
import { Input, Select, Badge } from '../components/ui'
import { useForm } from 'react-hook-form'
import type { User } from '../types'
import { ROLE_LABELS } from '../lib/utils'

export function SettingsPage() {
  const { user } = useAuthStore()
  const [activeSection, setActiveSection] = useState('health')

  const sections = [
    { id: 'health',          label: 'System health',    icon: <ActivityIcon size={15} /> },
    { id: 'infrastructure',  label: 'Infrastructure',   icon: <ServerIcon size={15} /> },
    { id: 'integrations',    label: 'Integrations',     icon: <ZapIcon size={15} /> },
    { id: 'llm',             label: 'AI configuration', icon: <ZapIcon size={15} /> },
    { id: 'audit',           label: 'Audit log',        icon: <ActivityIcon size={15} /> },
    { id: 'platform',        label: 'Platform',         icon: <ServerIcon size={15} /> },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <SectionHeader title="Settings" description="Platform configuration and system health." />
      <div className="flex gap-6">
        <nav className="w-44 flex-shrink-0 space-y-0.5">
          {sections.map(s => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={cn('w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors',
                activeSection === s.id ? 'bg-clay-50 text-clay-600 font-medium' : 'text-smoke-500 hover:bg-sand-100')}>
              {s.icon} {s.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 min-w-0">
          {activeSection === 'health'         && <HealthSection />}
          {activeSection === 'infrastructure' && <InfrastructureSection />}
          {activeSection === 'integrations'   && <IntegrationsSection />}
          {activeSection === 'llm'            && <LLMSection />}
          {activeSection === 'audit'          && <AuditLogSection />}
          {activeSection === 'platform'       && <PlatformSection />}
        </div>
      </div>
    </div>
  )
}

function HealthSection() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: () => setupApi.health().then(r => r.data),
    refetchInterval: 30_000,
  })
  if (isLoading) return <Spinner />
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-500">System health</h3>
        <span className={cn('badge', data?.status === 'healthy' ? 'text-go bg-go-light' : 'text-caution bg-caution-light')}>
          {data?.status}
        </span>
      </div>
      {data?.checks && Object.entries(data.checks).map(([key, check]: [string, any]) => (
        <div key={key} className="flex items-center justify-between py-2 border-b border-sand-100 last:border-0">
          <span className="text-sm text-ink-500 capitalize">{key.replace('_', ' ')}</span>
          <div className="flex items-center gap-2">
            {check.status === 'ok'
              ? <><CheckCircle2Icon size={14} className="text-go" /><span className="text-xs text-go">OK</span></>
              : <><AlertCircleIcon size={14} className="text-nogo" /><span className="text-xs text-nogo truncate max-w-xs">{check.error}</span></>
            }
            {check.chunks !== undefined && <span className="text-xs text-smoke-500">{check.chunks.toLocaleString()} chunks</span>}
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => refetch()} icon={<RefreshCwIcon size={13} />}>Refresh</Button>
    </div>
  )
}

const LLM_PROVIDERS_LIST = [
  { value: 'azure_openai', label: 'Azure OpenAI',  models: ['gpt-4o', 'gpt-4-turbo', 'gpt-35-turbo'],             needsEndpoint: true,  embeddingModels: [] /* free text — deployment name */,  embeddingNote: 'Enter your Azure embedding deployment name (e.g. text-embedding-3-small)' },
  { value: 'openai',       label: 'OpenAI',         models: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],            embeddingModels: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'] },
  { value: 'anthropic',    label: 'Anthropic',      models: ['claude-sonnet-4-6', 'claude-opus-4-6'],               embeddingModels: [], noEmbedding: true },
  { value: 'google',       label: 'Google Gemini',  models: ['gemini-1.5-pro', 'gemini-1.5-flash'],                 embeddingModels: ['text-embedding-004', 'embedding-001'] },
  { value: 'mistral',      label: 'Mistral AI',     models: ['mistral-large-latest', 'mistral-medium'],             embeddingModels: ['mistral-embed'] },
  { value: 'ollama',       label: 'Ollama (local)', models: ['llama3.1:8b', 'mistral:7b'],    needsEndpoint: true, noKey: true, embeddingModels: ['nomic-embed-text', 'mxbai-embed-large', 'all-minilm'] },
]

function LLMSection() {
  const qc = useQueryClient()
  const { data: providers = [], refetch } = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => setupApi.getLLMProviders().then(r => r.data),
  })

  const [provider,      setProvider]      = useState('azure_openai')
  const [model,         setModel]         = useState('')
  const [apiKey,        setApiKey]        = useState('')
  const [endpoint,      setEndpoint]      = useState('')
  const [apiVersion,    setApiVersion]    = useState('2024-02-01')
  const [displayName,   setDisplayName]   = useState('')
  const [embeddingModel, setEmbeddingModel] = useState('')
  const [prevEmbedding, setPrevEmbedding] = useState('')  // track if changed
  const [adding,        setAdding]        = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [testing,       setTesting]       = useState(false)
  const [reindexing,    setReindexing]    = useState(false)
  const [reindexResult, setReindexResult] = useState<any>(null)
  const [msg,           setMsg]           = useState<{ text: string; ok: boolean } | null>(null)

  const providerDef = LLM_PROVIDERS_LIST.find(p => p.value === provider)

  const handleSave = async () => {
    setSaving(true); setMsg(null)
    try {
      const prevEmb = providers.find((p: any) => p.is_active)?.embedding_model || ''
      await setupApi.addLLMProvider({
        provider, model, api_key: apiKey, endpoint,
        api_version: apiVersion,
        display_name: displayName || `${providerDef?.label} ${model}`,
        embedding_model: embeddingModel || undefined,
      })
      setPrevEmbedding(prevEmb)
      refetch()
      setAdding(false)
      setApiKey(''); setModel(''); setEndpoint(''); setEmbeddingModel('')
      setMsg({ text: 'Provider saved successfully.', ok: true })
    } catch (e: any) {
      setMsg({ text: e?.response?.data?.detail || 'Save failed.', ok: false })
    } finally { setSaving(false) }
  }

  const handleReindex = async () => {
    setReindexing(true); setMsg(null); setReindexResult(null)
    try {
      const res = await documentsApi.reindex()
      setReindexResult(res.data)
      setMsg({ text: res.data.message, ok: true })
    } catch (e: any) {
      setMsg({ text: e?.response?.data?.detail || 'Reindex failed.', ok: false })
    } finally { setReindexing(false) }
  }

  const handleTest = async () => {
    setTesting(true); setMsg(null)
    try {
      const res = await integrationsApi.testLLM({
        provider, model, api_key: apiKey, endpoint, api_version: apiVersion
      })
      setMsg({ text: res.data.message, ok: true })
    } catch (e: any) {
      setMsg({ text: e?.response?.data?.detail || 'Test failed.', ok: false })
    } finally { setTesting(false) }
  }

  return (
    <div className="space-y-4">
      {/* Existing providers */}
      {providers.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-ink-500 mb-3">Configured providers</h3>
          <div className="space-y-2">
            {providers.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-lg bg-sand-50 border border-sand-200">
                <div>
                  <p className="text-sm font-medium text-ink-500">{p.display_name}</p>
                  <p className="text-xs text-smoke-500">{p.provider} · {p.model}</p>
                </div>
                <div className="flex items-center gap-2">
                  {p.is_active && <span className="text-xs bg-go-light text-go px-2 py-0.5 rounded-full font-medium">Active</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active provider summary + reindex */}
      {providers.length > 0 && (
        <div className="card p-5 space-y-3">
          <h3 className="text-sm font-semibold text-ink-500">Embedding model</h3>
          {(() => {
            const active = providers.find((p: any) => p.is_active)
            const emb = active?.embedding_model
            return (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-smoke-500">Current model</span>
                  <span className="font-medium text-ink-500">
                    {emb ? `${active?.provider} / ${emb}` : 'local / all-MiniLM-L6-v2 (default)'}
                  </span>
                </div>
                <p className="text-xs text-smoke-400">
                  {emb
                    ? `Documents are being embedded using ${emb}. If you change the model, run re-index below.`
                    : 'Using the free local model. Add an embedding model above to use a cloud provider.'}
                </p>

                {/* Reindex section */}
                <div className="pt-3 border-t border-sand-100">
                  <p className="text-xs font-semibold text-smoke-500 mb-1">Re-index all documents</p>
                  <p className="text-xs text-smoke-400 mb-3">
                    Run this after changing the embedding model. Clears all existing vectors and re-embeds every document using the current model.
                  </p>
                  {reindexResult && (
                    <div className={`rounded-lg p-2.5 mb-3 text-xs ${reindexResult.failed === 0 ? 'bg-go-light text-go' : 'bg-caution/10 text-caution'}`}>
                      <p className="font-medium">{reindexResult.message}</p>
                      {reindexResult.failed > 0 && (
                        <p className="mt-1">{reindexResult.failed} failed: {reindexResult.errors?.slice(0,3).join(', ')}</p>
                      )}
                    </div>
                  )}
                  <button onClick={handleReindex} disabled={reindexing}
                    className="flex items-center gap-2 px-3 py-1.5 bg-caution/10 text-caution text-xs font-medium rounded-lg hover:bg-caution/20 disabled:opacity-50 transition-colors border border-caution/20">
                    {reindexing
                      ? <><RefreshCwIcon size={12} className="animate-spin" /> Re-indexing... this may take a while</>
                      : <><RefreshCwIcon size={12} /> Re-index all documents</>}
                  </button>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Add provider */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-ink-500">
              {providers.length === 0 ? 'Configure AI provider' : 'Add provider'}
            </h3>
            {providers.length === 0 && (
              <p className="text-xs text-smoke-500 mt-0.5">Required for bid generation and AI features.</p>
            )}
          </div>
          {providers.length > 0 && (
            <button onClick={() => setAdding(!adding)}
              className="text-xs text-clay-500 hover:text-clay-700 transition-colors">
              {adding ? 'Cancel' : '+ Add another'}
            </button>
          )}
        </div>

        {(adding || providers.length === 0) && (
          <div className="space-y-3">
            {/* Provider */}
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Provider</label>
              <select value={provider}
                onChange={e => { setProvider(e.target.value); setModel(''); setEndpoint('') }}
                className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none bg-white">
                {LLM_PROVIDERS_LIST.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            {/* Model */}
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">Model</label>
              <select value={model} onChange={e => setModel(e.target.value)}
                className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none bg-white">
                <option value="">Select model</option>
                {(providerDef?.models || []).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* API Key */}
            {!providerDef?.noKey && (
              <div>
                <label className="block text-xs font-medium text-smoke-500 mb-1">API key</label>
                <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                  placeholder="sk-..." 
                  className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
              </div>
            )}

            {/* Endpoint — Azure / Ollama */}
            {providerDef?.needsEndpoint && (
              <div>
                <label className="block text-xs font-medium text-smoke-500 mb-1">
                  {provider === 'ollama' ? 'Ollama URL' : 'Azure endpoint'}
                </label>
                <input value={endpoint} onChange={e => setEndpoint(e.target.value)}
                  placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://your-resource.openai.azure.com'}
                  className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
              </div>
            )}

            {/* API Version — Azure only */}
            {provider === 'azure_openai' && (
              <div>
                <label className="block text-xs font-medium text-smoke-500 mb-1">API version</label>
                <input value={apiVersion} onChange={e => setApiVersion(e.target.value)}
                  placeholder="2024-02-01"
                  className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
              </div>
            )}

            {/* Display name */}
            <div>
              <label className="block text-xs font-medium text-smoke-500 mb-1">
                Display name <span className="font-normal text-smoke-400">(optional)</span>
              </label>
              <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                placeholder={`e.g. ${providerDef?.label} ${model || 'GPT-4o'}`}
                className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
            </div>

            {/* Embedding model */}
            <div className="pt-2 border-t border-sand-100">
              <label className="block text-xs font-semibold text-smoke-500 mb-1">
                Embedding model <span className="font-normal text-smoke-400">(optional)</span>
              </label>
              {(providerDef as any)?.noEmbedding ? (
                <div className="rounded-lg bg-sand-100 p-2.5">
                  <p className="text-xs text-smoke-500">
                    ⚠ Anthropic does not provide embedding models.
                    Documents will use the local <strong>all-MiniLM-L6-v2</strong> model instead.
                  </p>
                </div>
              ) : (
                <>
                  {(providerDef as any)?.embeddingModels?.length > 0 ? (
                    <select value={embeddingModel}
                      onChange={e => setEmbeddingModel(e.target.value)}
                      className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none bg-white">
                      <option value="">Use default (local all-MiniLM-L6-v2)</option>
                      {(providerDef as any).embeddingModels.map((m: string) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={embeddingModel} onChange={e => setEmbeddingModel(e.target.value)}
                      placeholder={(providerDef as any)?.embeddingNote || 'e.g. text-embedding-3-small'}
                      className="w-full text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
                  )}
                  {embeddingModel && (
                    <div className="mt-2 rounded-lg bg-caution/10 border border-caution/20 p-2.5">
                      <p className="text-xs text-caution font-medium">⚠ Embedding model change requires re-indexing</p>
                      <p className="text-xs text-caution/80 mt-0.5">
                        After saving, click <strong>Re-index all documents</strong> to rebuild the vector database.
                        Existing search results will be incorrect until re-indexing is complete.
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-smoke-400 mt-1.5">
                    Leave blank to use the free local model. Set this if you want higher quality embeddings using your {providerDef?.label} API.
                  </p>
                </>
              )}
            </div>

            {/* Result message */}
            {msg && (
              <div className={`rounded-lg p-2.5 text-xs ${msg.ok ? 'bg-go-light text-go' : 'bg-nogo/10 text-nogo'}`}>
                {msg.text}
              </div>
            )}

            {/* Buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={handleSave} disabled={saving || !provider || !model}
                className="px-3 py-1.5 bg-clay-400 text-white text-xs rounded-lg hover:bg-clay-500 disabled:opacity-50 transition-colors">
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={handleTest} disabled={testing || !provider || !model || (!apiKey && !providerDef?.noKey)}
                className="px-3 py-1.5 bg-sand-200 text-ink-500 text-xs rounded-lg hover:bg-sand-300 disabled:opacity-50 transition-colors">
                {testing ? 'Testing...' : 'Test connection'}
              </button>
              {providers.length > 0 && (
                <button onClick={() => setAdding(false)}
                  className="px-3 py-1.5 bg-sand-100 text-smoke-600 text-xs rounded-lg hover:bg-sand-200 transition-colors">
                  Cancel
                </button>
              )}
            </div>
            <p className="text-xs text-smoke-400">
              Test sends a minimal request to verify credentials — no content is generated.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function PlatformSection() {
  const { data: config } = useQuery({
    queryKey: ['platform-config'],
    queryFn: () => setupApi.getConfig().then(r => r.data),
  })
  return (
    <div className="card p-5 space-y-3">
      <h3 className="text-sm font-semibold text-ink-500 mb-3">Platform configuration</h3>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {[
          ['Platform name', config?.platform_name],
          ['Vector DB', config?.vector_db_backend],
          ['Embedding backend', config?.embedding_backend],
          ['SSO', config?.sso_enabled ? 'Enabled' : 'Disabled'],
        ].map(([k, v]) => (
          <div key={k} className="p-3 rounded-lg bg-sand-50">
            <p className="text-xs text-smoke-500 mb-0.5">{k}</p>
            <p className="font-medium text-ink-500">{v || '—'}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Users Page ────────────────────────────────────────────────────
export function UsersPage() {
  const [adding, setAdding] = useState(false)
  const qc = useQueryClient()
  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: () => usersApi.list().then(r => r.data),
  })
  const { register, handleSubmit, reset } = useForm()

  const onAdd = async (data: any) => {
    await usersApi.create(data)
    reset()
    setAdding(false)
    qc.invalidateQueries({ queryKey: ['users'] })
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <SectionHeader
        title="Users"
        description="Manage who has access to the platform."
        action={<Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setAdding(!adding)}>Add user</Button>}
      />

      {adding && (
        <div className="card p-5 mb-6 animate-slide-up">
          <h3 className="text-sm font-semibold text-ink-500 mb-4">Add new user</h3>
          <form onSubmit={handleSubmit(onAdd)} className="grid grid-cols-2 gap-4">
            <Input label="Full name" {...register('full_name')} placeholder="Jane Smith" />
            <Input label="Email" type="email" {...register('email')} placeholder="jane@company.com" />
            <Input label="Password" type="password" {...register('password')} placeholder="••••••••" />
            <Select label="Role" {...register('role')} options={Object.entries(ROLE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
            <div className="col-span-2 flex gap-2">
              <Button type="submit" variant="primary" size="sm">Create user</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      {isLoading ? <Spinner /> : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-sand-200 bg-sand-50">
                {['User', 'Role', 'Status', 'Last sign in'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-smoke-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-sand-50 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-clay-400 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-semibold">{user.avatar_initials}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink-500">{user.full_name}</p>
                        <p className="text-xs text-smoke-500">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge>{ROLE_LABELS[user.role] || user.role}</Badge>
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge color={user.is_active ? 'text-go' : 'text-smoke-400'} bg={user.is_active ? 'bg-go-light' : 'bg-sand-200'}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-xs text-smoke-500">{user.last_login ? timeAgo(user.last_login) : 'Never'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Integrations Section ──────────────────────────────────────────
function IntegrationsSection() {
  return (
    <div className="space-y-6">
      <AzureADPanel />
      <SMTPPanel />
    </div>
  )
}

function AzureADPanel() {
  const qc = useQueryClient()
  const [tenantId,     setTenantId]     = useState('')
  const [clientId,     setClientId]     = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [enabled,      setEnabled]      = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [testing,      setTesting]      = useState(false)
  const [msg,          setMsg]          = useState<{ text: string; ok: boolean } | null>(null)

  const { data: cfg, isLoading } = useQuery({
    queryKey: ['integration', 'azure_ad'],
    queryFn: () => integrationsApi.get('azure_ad').then(r => r.data),
  })

  React.useEffect(() => {
    if (cfg) {
      setEnabled(cfg.enabled || false)
      setTenantId(cfg.config?.tenant_id || '')
      setClientId(cfg.config?.client_id || '')
      // Never pre-fill secret — always re-enter to update
    }
  }, [cfg])

  const handleSave = async () => {
    setSaving(true); setMsg(null)
    try {
      await integrationsApi.save('azure_ad', {
        enabled,
        config: { tenant_id: tenantId, client_id: clientId, client_secret: clientSecret || undefined }
      })
      qc.invalidateQueries({ queryKey: ['integration', 'azure_ad'] })
      setMsg({ text: 'Configuration saved.', ok: true })
      setClientSecret('')
    } catch (e: any) {
      setMsg({ text: e?.response?.data?.detail || 'Save failed.', ok: false })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true); setMsg(null)
    try {
      const res = await integrationsApi.testAzureAD()
      qc.invalidateQueries({ queryKey: ['integration', 'azure_ad'] })
      setMsg({ text: res.data.message, ok: true })
    } catch (e: any) {
      setMsg({ text: e?.response?.data?.detail || 'Test failed.', ok: false })
    } finally {
      setTesting(false)
    }
  }

  if (isLoading) return <Spinner />

  const isVerified = cfg?.verified

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-ink-500">Azure Active Directory</h3>
            {isVerified && (
              <span className="text-xs bg-go-light text-go px-2 py-0.5 rounded-full font-medium">Connected</span>
            )}
          </div>
          <p className="text-xs text-smoke-500 mt-0.5">
            Enable people search when adding bid team members. Uses Microsoft Graph API.
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
            className="w-4 h-4 accent-clay-400" />
          <span className="text-xs text-smoke-500">Enabled</span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-ink-500 mb-1">Tenant ID</label>
          <input value={tenantId} onChange={e => setTenantId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full px-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">Client ID (App ID)</label>
          <input value={clientId} onChange={e => setClientId(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            className="w-full px-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none font-mono" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">
            Client Secret {isVerified && <span className="text-smoke-400 font-normal">(leave blank to keep existing)</span>}
          </label>
          <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)}
            placeholder={isVerified ? '••••••••' : 'Enter client secret'}
            className="w-full px-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg p-2.5 mb-3 text-xs ${msg.ok ? 'bg-go-light text-go' : 'bg-nogo/10 text-nogo'}`}>
          {msg.text}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={handleSave} disabled={saving}
          className="px-3 py-1.5 bg-clay-400 text-white text-xs rounded-lg hover:bg-clay-500 disabled:opacity-50 transition-colors">
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button onClick={handleTest} disabled={testing || !tenantId || !clientId}
          className="px-3 py-1.5 bg-sand-200 text-ink-500 text-xs rounded-lg hover:bg-sand-300 disabled:opacity-50 transition-colors">
          {testing ? 'Testing...' : 'Test connection'}
        </button>
      </div>

      <div className="mt-4 rounded-lg bg-sand-100 p-3 text-xs text-smoke-500 space-y-1">
        <p className="font-medium text-ink-500">Setup in Azure Portal:</p>
        <p>1. Register an app in Azure AD → App registrations</p>
        <p>2. Add permission: <code className="bg-sand-200 px-1 rounded">Microsoft Graph → User.Read.All</code></p>
        <p>3. Grant admin consent for the permission</p>
        <p>4. Create a client secret under Certificates & secrets</p>
      </div>
    </div>
  )
}

function SMTPPanel() {
  const qc = useQueryClient()
  const [host,     setHost]     = useState('')
  const [port,     setPort]     = useState('587')
  const [user,     setUser]     = useState('')
  const [password, setPassword] = useState('')
  const [fromAddr, setFromAddr] = useState('')
  const [enabled,  setEnabled]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [msg,      setMsg]      = useState<{ text: string; ok: boolean } | null>(null)

  const { data: cfg } = useQuery({
    queryKey: ['integration', 'smtp'],
    queryFn: () => integrationsApi.get('smtp').then(r => r.data),
  })

  React.useEffect(() => {
    if (cfg) {
      setEnabled(cfg.enabled || false)
      setHost(cfg.config?.host || '')
      setPort(cfg.config?.port || '587')
      setUser(cfg.config?.user || '')
      setFromAddr(cfg.config?.from_address || '')
    }
  }, [cfg])

  const handleSave = async () => {
    setSaving(true); setMsg(null)
    try {
      await integrationsApi.save('smtp', {
        enabled,
        config: { host, port, user, from_address: fromAddr, password: password || undefined }
      })
      qc.invalidateQueries({ queryKey: ['integration', 'smtp'] })
      setMsg({ text: 'SMTP configuration saved.', ok: true })
      setPassword('')
    } catch (e: any) {
      setMsg({ text: e?.response?.data?.detail || 'Save failed.', ok: false })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true); setMsg(null)
    try {
      const res = await integrationsApi.testSMTP({
        host, port, user,
        password: password || undefined,
        from_address: fromAddr || undefined,
      })
      qc.invalidateQueries({ queryKey: ['integration', 'smtp'] })
      setMsg({ text: res.data.message, ok: true })
    } catch (e: any) {
      setMsg({ text: e?.response?.data?.detail || 'Test failed.', ok: false })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-ink-500">Email (SMTP)</h3>
          <p className="text-xs text-smoke-500 mt-0.5">
            Required for password reset emails and bid notifications.
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
            className="w-4 h-4 accent-clay-400" />
          <span className="text-xs text-smoke-500">Enabled</span>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">SMTP Host</label>
          <input value={host} onChange={e => setHost(e.target.value)}
            placeholder="smtp.office365.com"
            className="w-full px-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">Port</label>
          <input value={port} onChange={e => setPort(e.target.value)}
            placeholder="587"
            className="w-full px-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">Username</label>
          <input value={user} onChange={e => setUser(e.target.value)}
            placeholder="notifications@yourcompany.com"
            className="w-full px-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-500 mb-1">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder={cfg?.verified ? '••••••••' : 'Enter password'}
            className="w-full px-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-ink-500 mb-1">From address</label>
          <input value={fromAddr} onChange={e => setFromAddr(e.target.value)}
            placeholder="bids@yourcompany.com"
            className="w-full px-3 py-2 text-sm border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg p-2.5 mb-3 text-xs ${msg.ok ? 'bg-go-light text-go' : 'bg-nogo/10 text-nogo'}`}>
          {msg.text}
        </div>
      )}

      <button onClick={handleSave} disabled={saving}
        className="px-3 py-1.5 bg-clay-400 text-white text-xs rounded-lg hover:bg-clay-500 disabled:opacity-50 transition-colors">
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button onClick={handleTest} disabled={testing || !host}
        className="px-3 py-1.5 bg-sand-200 text-ink-500 text-xs rounded-lg hover:bg-sand-300 disabled:opacity-50 transition-colors">
        {testing ? 'Sending...' : 'Test connection'}
      </button>
      <p className="text-xs text-smoke-400">A test email will be sent to your admin account.</p>
    </div>
  )
}

// ── Document Detail Panel ─────────────────────────────────────────
// Expands inline below a KB document row showing contributors + lessons

const CONTRIBUTOR_ROLES = [
  'Bid Lead', 'Solution Architect', 'Commercial Lead',
  'Subject Matter Expert', 'Reviewer', 'Executive Sponsor',
  'Delivery Lead', 'Pricing Lead', 'Legal', 'Other'
]

function DocDetailPanel({ doc }: { doc: Document }) {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'contributors' | 'lessons'>('contributors')

  // Contributors
  const { data: contribData, isLoading: loadingC } = useQuery({
    queryKey: ['kb-contributors', doc.id],
    queryFn: () => kbApi.getContributors(doc.id).then(r => r.data),
  })
  const contributors: any[] = contribData?.contributors || []

  // Lessons
  const { data: lessonData, isLoading: loadingL } = useQuery({
    queryKey: ['kb-lesson', doc.id],
    queryFn: () => kbApi.getLesson(doc.id).then(r => r.data),
  })
  const lesson = lessonData?.lesson

  // AD availability
  const { data: adCfg } = useQuery({
    queryKey: ['integration', 'azure_ad'],
    queryFn: () => integrationsApi.get('azure_ad').then(r => r.data),
    staleTime: 60_000,
  })
  const adAvailable = adCfg?.enabled && adCfg?.verified

  // Add contributor state
  const [showAddC, setShowAddC]     = useState(false)
  const [cName, setCName]           = useState('')
  const [cEmail, setCEmail]         = useState('')
  const [cRole, setCRole]           = useState('Other')
  const [cTitle, setCTitle]         = useState('')
  const [cDept, setCDept]           = useState('')
  const [adSearch, setAdSearch]     = useState('')
  const [adResults, setAdResults]   = useState<any[]>([])
  const [adSearching, setAdSearching] = useState(false)
  const [adSelected, setAdSelected] = useState<any | null>(null)
  const [addingC, setAddingC]       = useState(false)
  const [cMsg, setCMsg]             = useState('')

  // Lesson form state
  const [lessonForm, setLessonForm] = useState({
    went_well: '', went_poorly: '', do_differently: '',
    evaluator_feedback: '', bid_outcome: '', score_received: '',
    flag_for_attention: false, status: 'draft' as 'draft' | 'published'
  })
  const [lessonEditing, setLessonEditing] = useState(false)
  const [savingL, setSavingL]             = useState(false)
  const [lessonMsg, setLessonMsg]         = useState('')

  // Populate lesson form when data loads
  React.useEffect(() => {
    if (lesson) {
      setLessonForm({
        went_well:          lesson.went_well || '',
        went_poorly:        lesson.went_poorly || '',
        do_differently:     lesson.do_differently || '',
        evaluator_feedback: lesson.evaluator_feedback || '',
        bid_outcome:        lesson.bid_outcome || '',
        score_received:     lesson.score_received || '',
        flag_for_attention: lesson.flag_for_attention || false,
        status:             lesson.status || 'draft',
      })
    }
  }, [lesson])

  // AD search debounce
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

  const handleAddContributor = async () => {
    setAddingC(true); setCMsg('')
    try {
      const payload: any = { document_id: doc.id, role: cRole }
      if (adAvailable && adSelected) {
        payload.display_name = adSelected.display_name
        payload.email        = adSelected.email
        payload.job_title    = adSelected.job_title
        payload.department   = adSelected.department
        payload.ad_object_id = adSelected.ad_object_id
      } else {
        if (!cName.trim()) { setCMsg('Please enter a name.'); setAddingC(false); return }
        payload.display_name = cName.trim()
        payload.email        = cEmail.trim() || undefined
        payload.job_title    = cTitle.trim() || undefined
        payload.department   = cDept.trim() || undefined
      }
      await kbApi.addContributor(payload)
      qc.invalidateQueries({ queryKey: ['kb-contributors', doc.id] })
      setShowAddC(false)
      setCName(''); setCEmail(''); setCRole('Other'); setCTitle(''); setCDept('')
      setAdSelected(null); setAdSearch('')
    } catch (e: any) {
      setCMsg(e?.response?.data?.detail || 'Failed to add contributor.')
    } finally {
      setAddingC(false) }
  }

  const handleRemoveContributor = async (id: string) => {
    if (!confirm('Remove this contributor?')) return
    await kbApi.removeContributor(id)
    qc.invalidateQueries({ queryKey: ['kb-contributors', doc.id] })
  }

  const handleSaveLesson = async () => {
    setSavingL(true); setLessonMsg('')
    try {
      await kbApi.upsertLesson({ document_id: doc.id, ...lessonForm })
      qc.invalidateQueries({ queryKey: ['kb-lesson', doc.id] })
      setLessonEditing(false)
      setLessonMsg('Saved successfully.')
    } catch (e: any) {
      setLessonMsg(e?.response?.data?.detail || 'Save failed.')
    } finally { setSavingL(false) }
  }

  const lf = (key: string) => (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement | HTMLSelectElement>) =>
    setLessonForm(f => ({ ...f, [key]: e.target.value }))

  return (
    <div className="bg-sand-50 border-t border-sand-200 px-4 py-4">
      {/* Tab strip */}
      <div className="flex gap-4 mb-4 border-b border-sand-200">
        {([['contributors', `Contributors (${contributors.length})`], ['lessons', 'Lessons Learned']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={cn('pb-2 text-xs font-medium border-b-2 transition-colors',
              activeTab === id ? 'border-clay-400 text-clay-600' : 'border-transparent text-smoke-500 hover:text-ink-500')}>
            {label}
            {id === 'lessons' && lesson?.flag_for_attention && (
              <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-caution" />
            )}
          </button>
        ))}
      </div>

      {/* ── Contributors tab ───────────────────────────── */}
      {activeTab === 'contributors' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-smoke-500">People who worked on this bid</p>
            <button onClick={() => setShowAddC(!showAddC)}
              className="flex items-center gap-1 text-xs text-clay-500 hover:text-clay-700 transition-colors">
              <PlusIcon size={12} /> Add person
            </button>
          </div>

          {/* Add contributor form */}
          {showAddC && (
            <div className="card p-3 bg-white space-y-2.5 border-clay-100">
              {adAvailable ? (
                <div className="space-y-2">
                  <div className="relative">
                    <SearchIcon size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-smoke-400" />
                    <input value={adSearch}
                      onChange={e => { setAdSearch(e.target.value); setAdSelected(null) }}
                      placeholder="Search Azure AD by name or email..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none"
                      autoFocus />
                  </div>
                  {adSearching && <p className="text-xs text-smoke-400">Searching...</p>}
                  {adResults.length > 0 && !adSelected && (
                    <div className="border border-sand-200 rounded-lg overflow-hidden">
                      {adResults.map(u => (
                        <button key={u.ad_object_id}
                          onClick={() => { setAdSelected(u); setAdSearch(u.display_name); setAdResults([]) }}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-sand-50 text-left border-b border-sand-100 last:border-0">
                          <div className="w-6 h-6 rounded-full bg-clay-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-xs font-semibold text-clay-600">
                              {u.display_name?.split(' ').map((n: string) => n[0]).join('').slice(0,2)}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-ink-500 truncate">{u.display_name}</p>
                            <p className="text-xs text-smoke-400 truncate">{u.email}{u.job_title && ` · ${u.job_title}`}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  {adSelected && (
                    <div className="rounded-lg bg-go-light border border-go/20 p-2 flex items-center gap-2">
                      <CheckCircle2Icon size={12} className="text-go" />
                      <p className="text-xs text-go font-medium">{adSelected.display_name}</p>
                      <button onClick={() => { setAdSelected(null); setAdSearch('') }}
                        className="ml-auto text-xs text-smoke-400 hover:text-nogo">✕</button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <input value={cName} onChange={e => setCName(e.target.value)}
                    placeholder="Full name *"
                    className="px-2.5 py-1.5 text-xs border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
                  <input value={cEmail} onChange={e => setCEmail(e.target.value)}
                    placeholder="Email (optional)"
                    className="px-2.5 py-1.5 text-xs border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
                  <input value={cTitle} onChange={e => setCTitle(e.target.value)}
                    placeholder="Job title (optional)"
                    className="px-2.5 py-1.5 text-xs border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
                  <input value={cDept} onChange={e => setCDept(e.target.value)}
                    placeholder="Department (optional)"
                    className="px-2.5 py-1.5 text-xs border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <select value={cRole} onChange={e => setCRole(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-xs border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none bg-white">
                  {CONTRIBUTOR_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <button onClick={handleAddContributor} disabled={addingC}
                  className="px-3 py-1.5 bg-clay-400 text-white text-xs rounded-lg hover:bg-clay-500 disabled:opacity-50 transition-colors">
                  {addingC ? 'Adding...' : 'Add'}
                </button>
                <button onClick={() => setShowAddC(false)}
                  className="px-3 py-1.5 bg-sand-200 text-smoke-600 text-xs rounded-lg hover:bg-sand-300 transition-colors">
                  Cancel
                </button>
              </div>
              {cMsg && <p className="text-xs text-nogo">{cMsg}</p>}
            </div>
          )}

          {/* Contributors list */}
          {loadingC ? <Spinner /> : contributors.length === 0 ? (
            <p className="text-xs text-smoke-400 py-2">No contributors recorded yet. Add the people who worked on this bid.</p>
          ) : (
            <div className="space-y-1.5">
              {contributors.map((c: any) => (
                <div key={c.id} className="flex items-center gap-2.5 p-2 rounded-lg bg-white border border-sand-200">
                  <div className="w-7 h-7 rounded-full bg-clay-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-clay-600">
                      {c.display_name.split(' ').map((n: string) => n[0]).join('').slice(0,2).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ink-500">{c.display_name}</p>
                    <p className="text-xs text-smoke-400 truncate">
                      {[c.role, c.job_title, c.department, c.email].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button onClick={() => handleRemoveContributor(c.id)}
                    className="text-smoke-300 hover:text-nogo transition-colors flex-shrink-0">
                    <Trash2Icon size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Lessons Learned tab ────────────────────────── */}
      {activeTab === 'lessons' && (
        <div className="space-y-3">
          {!lessonEditing && lesson ? (
            // Read view
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {lesson.flag_for_attention && (
                    <span className="flex items-center gap-1 text-xs font-medium text-caution bg-caution/10 px-2 py-0.5 rounded-full">
                      <AlertCircleIcon size={11} /> Must read for similar bids
                    </span>
                  )}
                  {lesson.bid_outcome && (
                    <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full',
                      lesson.bid_outcome === 'won' ? 'bg-go-light text-go' :
                      lesson.bid_outcome === 'lost' ? 'bg-nogo/10 text-nogo' : 'bg-sand-200 text-smoke-500')}>
                      {lesson.bid_outcome} {lesson.score_received && `· ${lesson.score_received}`}
                    </span>
                  )}
                </div>
                <button onClick={() => setLessonEditing(true)}
                  className="text-xs text-clay-500 hover:text-clay-700 transition-colors">Edit</button>
              </div>

              {lesson.went_well && (
                <div>
                  <p className="text-xs font-semibold text-go mb-1">✓ What went well</p>
                  <p className="text-xs text-smoke-600 leading-relaxed whitespace-pre-wrap">{lesson.went_well}</p>
                </div>
              )}
              {lesson.went_poorly && (
                <div>
                  <p className="text-xs font-semibold text-nogo mb-1">✗ What didn't go well</p>
                  <p className="text-xs text-smoke-600 leading-relaxed whitespace-pre-wrap">{lesson.went_poorly}</p>
                </div>
              )}
              {lesson.do_differently && (
                <div>
                  <p className="text-xs font-semibold text-caution mb-1">→ Do differently next time</p>
                  <p className="text-xs text-smoke-600 leading-relaxed whitespace-pre-wrap">{lesson.do_differently}</p>
                </div>
              )}
              {lesson.evaluator_feedback && (
                <div>
                  <p className="text-xs font-semibold text-info mb-1">💬 Client / evaluator feedback</p>
                  <p className="text-xs text-smoke-600 leading-relaxed whitespace-pre-wrap italic">{lesson.evaluator_feedback}</p>
                </div>
              )}
              <p className="text-xs text-smoke-400">
                {lesson.status === 'published' ? '● Published' : '○ Draft'} · by {lesson.created_by_name} · {timeAgo(lesson.updated_at)}
              </p>
            </div>
          ) : (
            // Edit / empty view
            <div className="space-y-3">
              {!lesson && !lessonEditing && (
                <div className="text-center py-4">
                  <p className="text-xs text-smoke-500 mb-3">No lessons recorded yet. Add feedback from this bid to help future teams.</p>
                  <button onClick={() => setLessonEditing(true)}
                    className="px-3 py-1.5 bg-clay-400 text-white text-xs rounded-lg hover:bg-clay-500 transition-colors">
                    + Add lessons learned
                  </button>
                </div>
              )}

              {lessonEditing && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-smoke-500 mb-1">Outcome</label>
                      <select value={lessonForm.bid_outcome} onChange={lf('bid_outcome')}
                        className="w-full px-2.5 py-1.5 text-xs border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none bg-white">
                        <option value="">Unknown</option>
                        <option value="won">Won</option>
                        <option value="lost">Lost</option>
                        <option value="partial">Partial / Shortlisted</option>
                        <option value="withdrawn">Withdrawn</option>
                        <option value="no_bid">No bid</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-smoke-500 mb-1">Score / ranking</label>
                      <input value={lessonForm.score_received} onChange={lf('score_received')}
                        placeholder="e.g. 78/100, 2nd of 4"
                        className="w-full px-2.5 py-1.5 text-xs border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none" />
                    </div>
                  </div>

                  {[
                    { key: 'went_well',          label: '✓ What went well',              placeholder: 'Strong technical solution, clear pricing, good executive summary...' },
                    { key: 'went_poorly',         label: '✗ What didn\'t go well',        placeholder: 'Weak commercial model, missed requirements, late submission...' },
                    { key: 'do_differently',      label: '→ Do differently next time',    placeholder: 'Involve pricing team earlier, more client discovery calls, use standard templates...' },
                    { key: 'evaluator_feedback',  label: '💬 Client / evaluator feedback', placeholder: 'Paste any written feedback received from the client or evaluators...' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-medium text-smoke-500 mb-1">{f.label}</label>
                      <textarea
                        value={(lessonForm as any)[f.key]}
                        onChange={lf(f.key) as any}
                        placeholder={f.placeholder}
                        rows={3}
                        className="w-full px-2.5 py-1.5 text-xs border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none resize-none"
                      />
                    </div>
                  ))}

                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox"
                        checked={lessonForm.flag_for_attention}
                        onChange={e => setLessonForm(f => ({ ...f, flag_for_attention: e.target.checked }))}
                        className="w-3.5 h-3.5 accent-caution" />
                      <span className="text-xs text-smoke-500">Flag as must-read for similar bids</span>
                    </label>
                    <select value={lessonForm.status} onChange={lf('status') as any}
                      className="text-xs px-2 py-1 border border-sand-300 rounded-lg focus:border-clay-400 focus:outline-none bg-white">
                      <option value="draft">Save as draft</option>
                      <option value="published">Publish</option>
                    </select>
                  </div>

                  {lessonMsg && (
                    <p className={cn('text-xs', lessonMsg.includes('fail') ? 'text-nogo' : 'text-go')}>{lessonMsg}</p>
                  )}

                  <div className="flex gap-2">
                    <button onClick={handleSaveLesson} disabled={savingL}
                      className="px-3 py-1.5 bg-clay-400 text-white text-xs rounded-lg hover:bg-clay-500 disabled:opacity-50 transition-colors">
                      {savingL ? 'Saving...' : 'Save lessons'}
                    </button>
                    <button onClick={() => { setLessonEditing(false); setLessonMsg('') }}
                      className="px-3 py-1.5 bg-sand-200 text-smoke-600 text-xs rounded-lg hover:bg-sand-300 transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Infrastructure Section ────────────────────────────────────────
function InfrastructureSection() {
  const { data: infra, isLoading } = useQuery({
    queryKey: ['infrastructure'],
    queryFn: () => setupApi.infrastructure().then(r => r.data),
    refetchInterval: 30_000,
  })
  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => setupApi.health().then(r => r.data),
    refetchInterval: 30_000,
  })

  if (isLoading) return <Spinner />

  const components = [
    {
      key:   'database',
      label: 'Relational Database',
      desc:  'Stores opportunities, users, bid sections and all application data.',
      current: infra?.database?.backend || 'sqlite',
      urlMasked: infra?.database?.url_masked,
      ready:   infra?.database?.is_production_ready,
      status:  health?.checks?.database?.status,
      options: [
        { value: 'sqlite',       label: 'SQLite',          note: 'Development & POC only. Single file, no concurrent users.', prod: false },
        { value: 'postgresql',   label: 'PostgreSQL',      note: 'Recommended for production. Full concurrency, ACID, scalable.', prod: true },
        { value: 'mssql',        label: 'Azure SQL / SQL Server', note: 'Enterprise. Azure-native, compliance, managed service.', prod: true },
      ],
      envExample: [
        '# PostgreSQL',
        'DATABASE_URL=postgresql://biduser:password@localhost:5432/bidplatform',
        '',
        '# Azure SQL',
        'DATABASE_URL=mssql+pyodbc://user:pass@server.database.windows.net/bidplatform?driver=ODBC+Driver+18+for+SQL+Server',
      ],
    },
    {
      key:   'vector_db',
      label: 'Vector Database',
      desc:  'Stores document embeddings for semantic search across the Knowledge Base.',
      current: infra?.vector_db?.backend || 'chroma',
      ready:   infra?.vector_db?.is_production_ready,
      status:  health?.checks?.vector_db?.status,
      options: [
        { value: 'chroma',         label: 'ChromaDB',         note: 'Development & POC. Embedded, zero setup.', prod: false },
        { value: 'pgvector',       label: 'pgvector',         note: 'Production. Uses your PostgreSQL — no extra service.', prod: true },
        { value: 'azure_ai_search',label: 'Azure AI Search',  note: 'Enterprise. Azure-native, RBAC, compliance, hybrid search.', prod: true },
        { value: 'pinecone',       label: 'Pinecone',         note: 'Managed cloud. Fully serverless, auto-scaling.', prod: true },
        { value: 'weaviate',       label: 'Weaviate',         note: 'Open source, self-hosted or cloud.', prod: true },
        { value: 'qdrant',         label: 'Qdrant',           note: 'Open source, self-hosted or cloud. High performance.', prod: true },
      ],
      envExample: [
        '# pgvector (same PostgreSQL as app)',
        'VECTOR_DB_BACKEND=pgvector',
        '',
        '# Azure AI Search',
        'VECTOR_DB_BACKEND=azure_ai_search',
        'AZURE_SEARCH_ENDPOINT=https://your-service.search.windows.net',
        'AZURE_SEARCH_API_KEY=your-admin-key',
      ],
    },
    {
      key:   'storage',
      label: 'File Storage',
      desc:  'Stores uploaded documents (PDFs, Word, Excel).',
      current: infra?.storage?.backend || 'local',
      ready:   infra?.storage?.is_production_ready,
      status:  health?.checks?.storage?.status,
      options: [
        { value: 'local',      label: 'Local disk',       note: 'Development only. Files lost on server restart.', prod: false },
        { value: 'azure_blob', label: 'Azure Blob Storage', note: 'Enterprise. Azure-native, geo-redundant, lifecycle policies.', prod: true },
        { value: 's3',         label: 'AWS S3',           note: 'Cloud-native. Scalable, durable, CDN integration.', prod: true },
      ],
      envExample: [
        '# Azure Blob',
        'STORAGE_BACKEND=azure_blob',
        'AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;...',
        'AZURE_STORAGE_CONTAINER=bid-platform-uploads',
      ],
    },
    {
      key:   'auth',
      label: 'Authentication',
      desc:  'How users sign in to the platform.',
      current: infra?.auth?.backend || 'local',
      ready:   infra?.auth?.is_production_ready,
      status:  health?.checks?.auth?.status,
      options: [
        { value: 'local',    label: 'Local JWT',      note: 'Email/password with bcrypt. Good for small teams.', prod: false },
        { value: 'azure_ad', label: 'Azure AD (SSO)', note: 'Microsoft Entra ID. Enterprise SSO, MFA, Conditional Access.', prod: true },
        { value: 'saml',     label: 'SAML 2.0',       note: 'Any enterprise IdP: Okta, PingFederate, ADFS.', prod: true },
      ],
      envExample: [
        '# Azure AD SSO',
        'AUTH_BACKEND=azure_ad',
        'AZURE_AD_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        'AZURE_AD_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        'AZURE_AD_CLIENT_SECRET=your-secret',
      ],
    },
    {
      key:   'secrets',
      label: 'Secrets Management',
      desc:  'How API keys and credentials are stored.',
      current: infra?.secrets?.backend || 'db',
      ready:   infra?.secrets?.is_production_ready,
      status:  health?.checks?.secrets?.status,
      options: [
        { value: 'db',               label: 'Database (plaintext)', note: '⚠ Development only. API keys in SQLite — never use in production.', prod: false },
        { value: 'env',              label: 'Environment variables', note: 'Simple production option. Secrets in .env file or container env vars.', prod: true },
        { value: 'azure_keyvault',   label: 'Azure Key Vault',      note: 'Enterprise. HSM-backed, RBAC, audit log, rotation.', prod: true },
        { value: 'hashicorp_vault',  label: 'HashiCorp Vault',      note: 'Enterprise. Multi-cloud, dynamic secrets, lease management.', prod: true },
      ],
      envExample: [
        '# Azure Key Vault',
        'SECRETS_BACKEND=azure_keyvault',
        'AZURE_KEYVAULT_URL=https://your-vault.vault.azure.net',
        '# Use managed identity (no secret needed) or:',
        'AZURE_KEYVAULT_CLIENT_ID=your-service-principal-id',
        'AZURE_KEYVAULT_SECRET=your-client-secret',
      ],
    },
    {
      key:   'jobs',
      label: 'Background Jobs',
      desc:  'How document ingestion and AI generation tasks are queued.',
      current: infra?.jobs?.backend || 'sync',
      ready:   infra?.jobs?.is_production_ready,
      status:  health?.checks?.jobs?.status,
      options: [
        { value: 'sync',             label: 'Synchronous (in-process)', note: 'Development. Blocks the API during long operations.', prod: false },
        { value: 'celery_redis',     label: 'Celery + Redis',           note: 'Production. Async workers, retries, monitoring.', prod: true },
        { value: 'azure_service_bus',label: 'Azure Service Bus',        note: 'Enterprise. Managed, guaranteed delivery, dead-letter queue.', prod: true },
      ],
      envExample: [
        '# Celery + Redis',
        'JOBS_BACKEND=celery_redis',
        'REDIS_URL=redis://localhost:6379/0',
        'CELERY_BROKER_URL=redis://localhost:6379/0',
        'CELERY_RESULT_BACKEND=redis://localhost:6379/1',
      ],
    },
  ]

  const prodReadyCount = components.filter(c => c.ready).length
  const envName = infra?.environment || 'development'

  return (
    <div className="space-y-6">
      {/* Environment summary */}
      <div className={cn('card p-5 border-2',
        envName === 'production' ? 'border-go bg-go-light/30' :
        envName === 'staging'    ? 'border-caution bg-caution/5' : 'border-sand-300')}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wide',
                envName === 'production' ? 'bg-go text-white' :
                envName === 'staging'    ? 'bg-caution text-white' : 'bg-sand-300 text-smoke-600')}>
                {envName}
              </span>
              <h3 className="text-sm font-semibold text-ink-500">Infrastructure Overview</h3>
            </div>
            <p className="text-xs text-smoke-500">
              {prodReadyCount}/{components.length} components configured for production
            </p>
          </div>
          <div className="flex gap-1">
            {components.map(c => (
              <div key={c.key} title={c.label}
                className={cn('w-2 h-2 rounded-full',
                  c.status === 'ok' ? 'bg-go' :
                  c.status === 'warn' ? 'bg-caution' :
                  c.status === 'error' ? 'bg-nogo' : 'bg-sand-300')} />
            ))}
          </div>
        </div>

        {!infra?.secrets?.is_production_ready && (
          <div className="mt-3 rounded-lg bg-nogo/10 border border-nogo/20 p-2.5">
            <p className="text-xs text-nogo font-medium">
              ⚠ API keys are stored as plaintext in the database.
              Set <code className="bg-nogo/10 px-1 rounded">SECRETS_BACKEND=env</code> or <code className="bg-nogo/10 px-1 rounded">azure_keyvault</code> before sharing this environment.
            </p>
          </div>
        )}
        {infra?.compliance && (
          <div className="mt-3 flex gap-4 text-xs text-smoke-500">
            <span>Data residency: <strong className="text-ink-500">{infra.compliance.data_residency}</strong></span>
            <span>GDPR mode: <strong className={infra.compliance.gdpr_mode ? 'text-go' : 'text-smoke-400'}>{infra.compliance.gdpr_mode ? 'on' : 'off'}</strong></span>
            <span>Audit log: <strong className={infra.compliance.audit_log ? 'text-go' : 'text-smoke-400'}>{infra.compliance.audit_log ? 'enabled' : 'disabled'}</strong></span>
          </div>
        )}
      </div>

      {/* Component cards */}
      {components.map(comp => (
        <InfraCard key={comp.key} comp={comp} healthStatus={health?.checks?.[comp.key]} />
      ))}

      {/* .env guidance */}
      <div className="card p-5 bg-ink-500">
        <h3 className="text-sm font-semibold text-sand-100 mb-2">How to change infrastructure</h3>
        <p className="text-xs text-sand-300 mb-3">
          All infrastructure is configured via environment variables in the <code className="bg-white/10 px-1 rounded">.env</code> file
          (or container environment variables in production). No code changes required.
        </p>
        <div className="text-xs text-sand-300 space-y-1 font-mono">
          <p className="text-sand-400"># 1. Open backend/.env</p>
          <p className="text-sand-400"># 2. Change the backend setting</p>
          <p className="text-sand-400"># 3. Add required credentials</p>
          <p className="text-sand-400"># 4. Restart the application</p>
        </div>
        <p className="text-xs text-sand-400 mt-3">
          See <code className="bg-white/10 px-1 rounded">backend/.env.example</code> for all options with documentation.
        </p>
      </div>
    </div>
  )
}

function InfraCard({ comp, healthStatus }: { comp: any; healthStatus: any }) {
  const [showEnv, setShowEnv] = useState(false)
  const currentOption = comp.options.find((o: any) => o.value === comp.current)
  const isProd = currentOption?.prod === true
  const status = healthStatus?.status || 'unknown'

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-ink-500">{comp.label}</h3>
            <div className={cn('w-2 h-2 rounded-full flex-shrink-0',
              status === 'ok' ? 'bg-go' : status === 'warn' ? 'bg-caution' : status === 'error' ? 'bg-nogo' : 'bg-sand-300')} />
            <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full',
              isProd ? 'bg-go-light text-go' : 'bg-caution/10 text-caution')}>
              {isProd ? '✓ Production ready' : '⚠ Dev / POC only'}
            </span>
          </div>
          <p className="text-xs text-smoke-500">{comp.desc}</p>
        </div>
        <div className="text-right ml-4 flex-shrink-0">
          <p className="text-xs text-smoke-400">Current</p>
          <p className="text-sm font-semibold text-ink-500">{currentOption?.label || comp.current}</p>
        </div>
      </div>

      {/* Available options */}
      <div className="space-y-2 mb-3">
        {comp.options.map((opt: any) => (
          <div key={opt.value}
            className={cn('flex items-start gap-3 p-2.5 rounded-lg text-xs',
              opt.value === comp.current ? 'bg-clay-50 border border-clay-200' : 'bg-sand-50 border border-sand-100')}>
            <div className={cn('w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5',
              opt.value === comp.current ? 'bg-clay-400' : 'bg-sand-200')}>
              {opt.value === comp.current && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn('font-medium', opt.value === comp.current ? 'text-clay-700' : 'text-ink-500')}>
                  {opt.label}
                </span>
                {opt.prod ? (
                  <span className="text-go bg-go-light px-1.5 py-0.5 rounded text-xs">prod</span>
                ) : (
                  <span className="text-caution bg-caution/10 px-1.5 py-0.5 rounded text-xs">dev</span>
                )}
              </div>
              <p className="text-smoke-500 mt-0.5">{opt.note}</p>
            </div>
          </div>
        ))}
      </div>

      {/* .env snippet toggle */}
      {comp.envExample && (
        <div>
          <button onClick={() => setShowEnv(!showEnv)}
            className="text-xs text-clay-500 hover:text-clay-700 transition-colors flex items-center gap-1">
            {showEnv ? '▼' : '▶'} How to configure in .env
          </button>
          {showEnv && (
            <div className="mt-2 bg-ink-500 rounded-lg p-3 font-mono text-xs text-sand-200">
              {comp.envExample.map((line: string, i: number) => (
                <p key={i} className={line.startsWith('#') ? 'text-sand-400' : ''}>{line || '\u00a0'}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Audit Log Section ─────────────────────────────────────────────
function AuditLogSection() {
  const [page, setPage]           = useState(0)
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const limit = 50

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit-log', page, filterUser, filterAction],
    queryFn: () => dashboardApi.auditLog({
      skip:    page * limit,
      limit,
      user_id: filterUser  || undefined,
      action:  filterAction || undefined,
    }).then(r => r.data),
    staleTime: 30_000,
  })

  const logs: any[]  = data?.logs || []
  const total: number = data?.total || 0
  const pages = Math.ceil(total / limit)

  const ACTION_COLOURS: Record<string, string> = {
    created:            'bg-go-light text-go',
    submitted:          'bg-info/10 text-info',
    capture_result:     'bg-clay-100 text-clay-600',
    generation_completed: 'bg-caution/10 text-caution',
    approved:           'bg-go-light text-go',
    changes_requested:  'bg-nogo/10 text-nogo',
    deleted:            'bg-nogo/10 text-nogo',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink-500">Audit Log</h3>
          <p className="text-xs text-smoke-500 mt-0.5">{total.toLocaleString()} events recorded</p>
        </div>
        <button onClick={() => refetch()}
          className="text-xs text-clay-500 hover:text-clay-700 transition-colors flex items-center gap-1">
          <RefreshCwIcon size={12} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <input value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(0) }}
          placeholder="Filter by action..."
          className="flex-1 text-sm border border-sand-300 rounded-lg px-3 py-1.5 focus:border-clay-400 focus:outline-none" />
        <button onClick={() => { setFilterUser(''); setFilterAction(''); setPage(0) }}
          className="px-3 py-1.5 text-xs bg-sand-200 text-smoke-600 rounded-lg hover:bg-sand-300 transition-colors">
          Clear
        </button>
      </div>

      {/* Log entries */}
      {isLoading ? <Spinner /> : logs.length === 0 ? (
        <div className="card p-8 text-center">
          <ActivityIcon size={28} className="text-sand-300 mx-auto mb-3" />
          <p className="text-sm text-smoke-500">No audit log entries yet.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y divide-sand-100">
            {logs.map((log: any) => (
              <div key={log.id} className="flex items-start gap-3 px-4 py-3 hover:bg-sand-50 transition-colors">
                <div className="flex-shrink-0 mt-0.5">
                  <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full',
                    ACTION_COLOURS[log.action] || 'bg-sand-200 text-smoke-500')}>
                    {log.action.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  {log.detail && (
                    <p className="text-sm text-ink-500 truncate">{log.detail}</p>
                  )}
                  <div className="flex items-center gap-3 mt-0.5">
                    {log.user_name && (
                      <span className="text-xs text-smoke-500">{log.user_name}</span>
                    )}
                    {log.opportunity_id && (
                      <span className="text-xs text-smoke-400">opp: {log.opportunity_id.slice(0,8)}…</span>
                    )}
                  </div>
                </div>
                <span className="text-xs text-smoke-400 flex-shrink-0">
                  {new Date(log.created_at).toLocaleString('en-GB', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-xs text-smoke-500">
          <span>Page {page + 1} of {pages} ({total} entries)</span>
          <div className="flex gap-2">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 bg-sand-200 rounded-lg disabled:opacity-40 hover:bg-sand-300 transition-colors">
              ← Prev
            </button>
            <button disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 bg-sand-200 rounded-lg disabled:opacity-40 hover:bg-sand-300 transition-colors">
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
