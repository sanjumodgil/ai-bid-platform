import React from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '../lib/api'
import { useAuthStore } from '../lib/api'
import { Spinner, Badge } from '../components/ui'
import {
  FolderOpenIcon, BookOpenIcon, UsersIcon, TrendingUpIcon,
  ArrowRightIcon, AlertCircleIcon, MessageSquareIcon, ZapIcon,
  ShieldIcon, ClockIcon, CheckCircle2Icon
} from '../components/ui/icons'
import { STATUS_CONFIG, INDUSTRY_LABELS, timeAgo, cn } from '../lib/utils'
import type { DashboardStats, OpportunityStatus } from '../types'

function StatCard({ label, value, icon, sub, color = 'text-clay-400', href }: {
  label: string; value: number | string; icon: React.ReactNode
  sub?: string; color?: string; href?: string
}) {
  const inner = (
    <div className={cn('card p-5 transition-colors', href && 'hover:border-clay-200 cursor-pointer')}>
      <div className="flex items-start justify-between mb-3">
        <div className={cn('p-2 rounded-lg bg-sand-100', color)}>{icon}</div>
      </div>
      <p className="text-2xl font-semibold text-ink-500 mb-0.5">{value}</p>
      <p className="text-sm text-smoke-500">{label}</p>
      {sub && <p className="text-xs text-smoke-400 mt-1">{sub}</p>}
    </div>
  )
  return href ? <Link to={href}>{inner}</Link> : inner
}

export function DashboardPage() {
  const { user } = useAuthStore()

  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.stats().then(r => r.data),
    refetchInterval: 30_000,
  })

  const { data: reviewData } = useQuery({
    queryKey: ['my-reviews'],
    queryFn: () => dashboardApi.myReviews().then(r => r.data),
    refetchInterval: 60_000,
  })
  const myReviews: any[] = reviewData?.sections || []

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const p2 = (data as any)?.phase2

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-ink-500">
          {greeting}, {user?.full_name?.split(' ')[0]}
        </h1>
        <p className="text-sm text-smoke-500 mt-0.5">Here's what's happening across your bid pipeline.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-48"><Spinner /></div>
      ) : data ? (
        <>
          {/* LLM config warning */}
          {data.config_status && !data.config_status.llm?.configured && (
            <div className="mb-6 rounded-xl border border-caution/30 bg-caution/5 p-4 flex items-start gap-3">
              <AlertCircleIcon size={16} className="text-caution flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-caution">AI features not available</p>
                <p className="text-xs text-caution/80 mt-0.5">
                  {data.config_status.llm?.reason || 'No LLM provider configured.'}{' '}
                  <a href="/settings" className="underline hover:no-underline">Go to Settings → AI Configuration</a>
                </p>
              </div>
            </div>
          )}

          {/* My Reviews alert banner */}
          {myReviews.length > 0 && (
            <div className="mb-6 rounded-xl border border-clay-200 bg-clay-50 p-4 flex items-center gap-3">
              <MessageSquareIcon size={16} className="text-clay-500 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-clay-700">
                  You have {myReviews.length} section{myReviews.length !== 1 ? 's' : ''} awaiting your review
                </p>
                <p className="text-xs text-clay-500 mt-0.5">
                  {myReviews.slice(0, 2).map((r: any) => r.opportunity_name).join(', ')}
                  {myReviews.length > 2 ? ` and ${myReviews.length - 2} more` : ''}
                </p>
              </div>
              <a href="#my-reviews" className="text-xs text-clay-600 font-medium hover:underline flex-shrink-0">
                View queue →
              </a>
            </div>
          )}

          {/* Phase 1 stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total opportunities" value={data.total_opportunities}
              icon={<FolderOpenIcon size={18} />} href="/opportunities" />
            <StatCard label="Active" value={data.active_opportunities}
              icon={<TrendingUpIcon size={18} />} color="text-info" href="/opportunities" />
            <StatCard label="Knowledge base" value={`${(data.kb_chunks || 0).toLocaleString()} chunks`}
              icon={<BookOpenIcon size={18} />} sub={`${data.kb_documents} documents`}
              color="text-go" href="/knowledge-base" />
            <StatCard label="Team members" value={data.total_users}
              icon={<UsersIcon size={18} />} color="text-caution" />
          </div>

          {/* Phase 2 stats — only show when there's generation activity */}
          {p2 && (p2.sections_pending_review > 0 || p2.sections_approved_week > 0 || p2.sections_low_confidence > 0) && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              <StatCard label="Pending review" value={p2.sections_pending_review}
                icon={<MessageSquareIcon size={18} />}
                color={p2.sections_pending_review > 0 ? 'text-caution' : 'text-smoke-400'}
                sub="sections awaiting approval" />
              <StatCard label="Approved this week" value={p2.sections_approved_week}
                icon={<CheckCircle2Icon size={18} />} color="text-go"
                sub="sections signed off" />
              <StatCard label="Low confidence" value={p2.sections_low_confidence}
                icon={<ShieldIcon size={18} />}
                color={p2.sections_low_confidence > 0 ? 'text-nogo' : 'text-smoke-400'}
                sub="sections flagged for review" />
            </div>
          )}

          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              {/* Recent opportunities */}
              <div className="card">
                <div className="flex items-center justify-between px-5 py-4 border-b border-sand-100">
                  <h2 className="text-sm font-semibold text-ink-500">Recent opportunities</h2>
                  <Link to="/opportunities" className="text-xs text-clay-500 hover:text-clay-600 flex items-center gap-1 transition-colors">
                    View all <ArrowRightIcon size={12} />
                  </Link>
                </div>
                <div className="divide-y divide-sand-100">
                  {data.recent_opportunities.length === 0 ? (
                    <div className="p-8 text-center">
                      <FolderOpenIcon size={28} className="text-sand-300 mx-auto mb-2" />
                      <p className="text-sm text-smoke-500">No opportunities yet</p>
                      <Link to="/opportunities/new" className="text-xs text-clay-500 hover:underline mt-1 inline-block">
                        Create your first opportunity →
                      </Link>
                    </div>
                  ) : data.recent_opportunities.map((opp) => {
                    const cfg = STATUS_CONFIG[opp.status as OpportunityStatus]
                    const canGenerate = ['under_review','submitted','under_evaluation','shortlisted'].includes(opp.status)
                    return (
                      <div key={opp.id} className="flex items-center gap-3 px-5 py-3.5 hover:bg-sand-50 transition-colors group">
                        <div className="w-8 h-8 rounded-lg bg-sand-100 flex items-center justify-center flex-shrink-0 group-hover:bg-clay-50 transition-colors">
                          <FolderOpenIcon size={14} className="text-smoke-400 group-hover:text-clay-400 transition-colors" />
                        </div>
                        <Link to={`/opportunities/${opp.id}`} className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-ink-500 truncate">{opp.name}</p>
                          <p className="text-xs text-smoke-500 truncate">{opp.client}</p>
                        </Link>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge color={cfg?.color} bg={cfg?.bg}>{cfg?.label}</Badge>
                          {canGenerate && (
                            <Link to={`/opportunities/${opp.id}/generate`}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-clay-50 text-clay-600 hover:bg-clay-100 transition-colors text-xs font-medium">
                              <ZapIcon size={11} /> Generate
                            </Link>
                          )}
                          <span className="text-xs text-smoke-400 hidden sm:block">{timeAgo(opp.updated_at)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* My review queue */}
              {myReviews.length > 0 && (
                <div id="my-reviews" className="card">
                  <div className="flex items-center justify-between px-5 py-4 border-b border-sand-100">
                    <h2 className="text-sm font-semibold text-ink-500 flex items-center gap-2">
                      <MessageSquareIcon size={14} className="text-clay-400" />
                      My review queue
                      <span className="text-xs bg-clay-400 text-white rounded-full px-1.5 py-0.5 leading-none">{myReviews.length}</span>
                    </h2>
                  </div>
                  <div className="divide-y divide-sand-100">
                    {myReviews.map((r: any) => {
                      const statusColour = r.review_status === 'changes_requested'
                        ? 'text-nogo bg-nogo/10'
                        : 'text-caution bg-caution/10'
                      const conf = r.confidence_overall
                      return (
                        <Link key={r.section_id}
                          to={`/opportunities/${r.opportunity_id}/generate`}
                          className="flex items-center gap-3 px-5 py-3.5 hover:bg-sand-50 transition-colors group">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-ink-500 truncate">{r.section_title}</p>
                            <p className="text-xs text-smoke-500 mt-0.5 truncate">
                              {r.opportunity_name} · {r.client_name}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {conf && (
                              <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full',
                                conf >= 80 ? 'text-go bg-go-light' : conf >= 60 ? 'text-caution bg-caution/10' : 'text-nogo bg-nogo/10')}>
                                {Math.round(conf)}%
                              </span>
                            )}
                            <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', statusColour)}>
                              {r.review_status === 'changes_requested' ? 'Changes needed' : 'Awaiting review'}
                            </span>
                            <span className="text-xs text-smoke-400 hidden sm:block">{timeAgo(r.updated_at)}</span>
                          </div>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4">
              {/* Quick actions */}
              <div className="card p-5">
                <h2 className="text-sm font-semibold text-ink-500 mb-4">Quick actions</h2>
                <div className="space-y-2">
                  <Link to="/opportunities/new"
                    className="flex items-center gap-3 p-3 rounded-lg bg-clay-400 text-white hover:bg-clay-500 transition-colors">
                    <FolderOpenIcon size={15} />
                    <span className="text-sm font-medium">New opportunity</span>
                  </Link>
                  <Link to="/knowledge-base"
                    className="flex items-center gap-3 p-3 rounded-lg bg-sand-100 text-ink-500 hover:bg-sand-200 transition-colors">
                    <BookOpenIcon size={15} className="text-smoke-400" />
                    <span className="text-sm font-medium">Upload to KB</span>
                  </Link>
                  <Link to="/settings"
                    className="flex items-center gap-3 p-3 rounded-lg bg-sand-100 text-ink-500 hover:bg-sand-200 transition-colors">
                    <ShieldIcon size={15} className="text-smoke-400" />
                    <span className="text-sm font-medium">Settings</span>
                  </Link>
                </div>
              </div>

              {/* Upcoming deadlines */}
              {p2?.upcoming_deadlines?.length > 0 && (
                <div className="card p-5">
                  <h2 className="text-sm font-semibold text-ink-500 mb-3 flex items-center gap-2">
                    <ClockIcon size={14} className="text-caution" /> Upcoming deadlines
                  </h2>
                  <div className="space-y-2">
                    {p2.upcoming_deadlines.map((d: any) => (
                      <Link key={d.id} to={`/opportunities/${d.id}`}
                        className="flex items-center justify-between p-2.5 rounded-lg hover:bg-sand-50 transition-colors">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-ink-500 truncate">{d.name}</p>
                          <p className="text-xs text-smoke-400 truncate">{d.client}</p>
                        </div>
                        <span className={cn('text-xs font-semibold ml-2 flex-shrink-0',
                          d.days_left <= 3 ? 'text-nogo' : d.days_left <= 7 ? 'text-caution' : 'text-smoke-500')}>
                          {d.days_left === 0 ? 'Today' : d.days_left === 1 ? 'Tomorrow' : `${d.days_left}d`}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
