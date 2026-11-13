import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { opportunitiesApi } from '../lib/api'
import { Button, Input, Select, Textarea, Badge, Spinner, CFAVScore, EmptyState, SectionHeader } from '../components/ui'
import { FolderOpenIcon, PlusIcon, SearchIcon, ArrowRightIcon, Building2Icon, ZapIcon } from '../components/ui/icons'
import { STATUS_CONFIG, GONOGO_CONFIG, INDUSTRY_LABELS, INDUSTRY_SUBDOMAINS, formatDate, timeAgo, cn } from '../lib/utils'
import type { Opportunity, OpportunityStatus, GoNoGoStatus } from '../types'

// ── Opportunities List ────────────────────────────────────────────
export function OpportunitiesPage() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: opps = [], isLoading } = useQuery<Opportunity[]>({
    queryKey: ['opportunities', search, statusFilter],
    queryFn: () => opportunitiesApi.list({ search: search || undefined, status: statusFilter || undefined }).then(r => r.data),
    staleTime: 30_000,
  })

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <SectionHeader
        title="Opportunities"
        description="Manage your active bid pipeline across all stages."
        action={
          <Link to="/opportunities/new">
            <Button variant="primary" icon={<PlusIcon size={15} />}>New opportunity</Button>
          </Link>
        }
      />

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-xs">
          <SearchIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-smoke-400 pointer-events-none" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search opportunities..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-sand-300 bg-white focus:border-clay-400 focus:ring-2 focus:ring-clay-400/20 focus:outline-none"
          />
        </div>
        <select
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="text-sm rounded-lg border border-sand-300 bg-white px-3 py-2 focus:border-clay-400 focus:outline-none"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48"><Spinner /></div>
      ) : opps.length === 0 ? (
        <EmptyState
          icon={<FolderOpenIcon size={40} />}
          title={search || statusFilter ? "No matching opportunities" : "No opportunities yet"}
          description={search || statusFilter ? "Try adjusting your filters" : "Create your first opportunity to start building a bid response."}
          action={!search && !statusFilter ? (
            <Link to="/opportunities/new"><Button variant="primary" icon={<PlusIcon size={15} />}>New opportunity</Button></Link>
          ) : undefined}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-sand-200 bg-sand-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-smoke-500 uppercase tracking-wide">Opportunity</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-smoke-500 uppercase tracking-wide hidden md:table-cell">Industry</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-smoke-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-smoke-500 uppercase tracking-wide hidden lg:table-cell">CFAV</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-smoke-500 uppercase tracking-wide hidden lg:table-cell">Deadline</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-smoke-500 uppercase tracking-wide hidden sm:table-cell">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-sand-100">
              {opps.map((opp) => {
                const sc = STATUS_CONFIG[opp.status as OpportunityStatus]
                const gc = GONOGO_CONFIG[opp.go_no_go_status as GoNoGoStatus]
                return (
                  <tr key={opp.id} className="hover:bg-sand-50 transition-colors group">
                    <td className="px-4 py-3.5">
                      <Link to={`/opportunities/${opp.id}`} className="block">
                        <p className="text-sm font-medium text-ink-500 group-hover:text-clay-600 transition-colors">{opp.name}</p>
                        <p className="text-xs text-smoke-500 mt-0.5 flex items-center gap-1">
                          <Building2Icon size={11} className="flex-shrink-0" />
                          {opp.client_name}
                        </p>
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell">
                      <span className="text-xs text-smoke-500">
                        {INDUSTRY_LABELS[opp.industry_vertical] || opp.industry_vertical}
                        {opp.sub_domain && ` › ${INDUSTRY_SUBDOMAINS[opp.industry_vertical]?.find(s => s.value === opp.sub_domain)?.label || opp.sub_domain}`}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge color={sc?.color} bg={sc?.bg}>{sc?.label}</Badge>
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell">
                      <CFAVScore score={opp.cfav_score} size="sm" />
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell">
                      <span className="text-xs text-smoke-500">{formatDate(opp.submission_deadline)}</span>
                    </td>
                    <td className="px-4 py-3.5 hidden sm:table-cell">
                      <span className="text-xs text-smoke-400">{timeAgo(opp.updated_at)}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1">
                        {['under_review', 'submitted', 'under_evaluation', 'shortlisted'].includes(opp.status) && (
                          <Link to={`/opportunities/${opp.id}/generate`}>
                            <button className="flex items-center gap-1 px-2 py-1 rounded-lg bg-clay-50 text-clay-600 hover:bg-clay-100 transition-colors text-xs font-medium">
                              <ZapIcon size={11} /> Generate
                            </button>
                          </Link>
                        )}
                        <Link to={`/opportunities/${opp.id}`}>
                          <button className="p-1.5 rounded-lg hover:bg-sand-200 text-smoke-400 hover:text-ink-500 transition-colors">
                            <ArrowRightIcon size={14} />
                          </button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Create Opportunity Form ───────────────────────────────────────
const createSchema = z.object({
  name: z.string().min(2, 'Required'),
  client_name: z.string().min(1, 'Required'),
  procurement_reference: z.string().optional(),
  industry_vertical: z.string(),
  sub_domain: z.string().optional(),
  solution_type: z.string().optional(),
  geography: z.string().optional(),
  submission_deadline: z.string().optional(),
  estimated_value: z.string().optional(),
  notes: z.string().optional(),
})

export function NewOpportunityPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [selectedVertical, setSelectedVertical] = useState('other')

  const { register, handleSubmit, formState: { errors, isSubmitting }, watch, setValue } = useForm({
    resolver: zodResolver(createSchema),
    defaultValues: { industry_vertical: 'other' },
  })

  const subDomains = INDUSTRY_SUBDOMAINS[selectedVertical] || []

  const mutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => opportunitiesApi.create(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['opportunities'] })
      navigate(`/opportunities/${res.data.id}`)
    },
  })

  const onSubmit = async (data: Record<string, unknown>) => {
    const payload = { ...data, estimated_value: data.estimated_value ? parseFloat(data.estimated_value as string) : null }
    await mutation.mutateAsync(payload)
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <SectionHeader title="New opportunity" description="Set up the workspace for this bid." />

      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="card p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Input label="Opportunity name" {...register('name')} error={errors.name?.message} placeholder="e.g. Digital Transformation Programme — Barclays" autoFocus />
            </div>
            <Input label="Client name" {...register('client_name')} error={errors.client_name?.message} placeholder="Client organisation" />
            <Input label="Procurement reference" {...register('procurement_reference')} placeholder="ITT-2025-001" />
            <Select
              label="Industry vertical"
              {...register('industry_vertical')}
              onChange={e => {
                setValue('industry_vertical', e.target.value)
                setValue('sub_domain', '')
                setSelectedVertical(e.target.value)
              }}
              options={Object.entries(INDUSTRY_LABELS).map(([k, v]) => ({ value: k, label: v }))}
            />
            <Select
              label="Sub-domain"
              {...register('sub_domain')}
              options={[
                { value: '', label: subDomains.length ? 'Select sub-domain (optional)' : '— select industry first —' },
                ...subDomains
              ]}
              disabled={subDomains.length === 0}
            />
            <Input label="Solution type" {...register('solution_type')} placeholder="e.g. Cloud Migration" />
            <Input label="Geography" {...register('geography')} placeholder="e.g. UK, EU" />
            <Input label="Submission deadline" type="datetime-local" {...register('submission_deadline')} />
            <Input label="Estimated deal value (£)" type="number" {...register('estimated_value')} placeholder="0" />
            <div className="col-span-2">
              <Textarea label="Notes" {...register('notes')} rows={3} placeholder="Add any context, background, or initial thoughts..." />
            </div>
          </div>
        </div>

        {mutation.error && (
          <p className="text-xs text-nogo mt-3">{(mutation.error as any)?.response?.data?.detail || 'Failed to create opportunity'}</p>
        )}

        <div className="flex justify-between mt-6">
          <Button type="button" variant="ghost" onClick={() => navigate('/opportunities')}>Cancel</Button>
          <Button type="submit" variant="primary" loading={isSubmitting}>Create opportunity</Button>
        </div>
      </form>
    </div>
  )
}
