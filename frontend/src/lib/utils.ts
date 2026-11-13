import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow } from 'date-fns'
import type { OpportunityStatus, GoNoGoStatus, DocumentStatus } from '../types'

// Inline cn — no clsx dependency, avoids VS2022 TS2307 on @types/clsx
type ClassValue = string | number | boolean | undefined | null | ClassValue[]
function clsx(...args: ClassValue[]): string {
  return args.flat(Infinity as 1).filter(Boolean).join(' ')
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(...inputs))
}

export function formatDate(date: string | null | undefined) {
  if (!date) return '—'
  return format(new Date(date), 'dd MMM yyyy')
}

export function formatDatetime(date: string | null | undefined) {
  if (!date) return '—'
  return format(new Date(date), 'dd MMM yyyy, HH:mm')
}

export function timeAgo(date: string | null | undefined) {
  if (!date) return '—'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const STATUS_CONFIG: Record<OpportunityStatus, { label: string; color: string; bg: string }> = {
  draft:            { label: 'Draft',            color: 'text-smoke-500', bg: 'bg-sand-200' },
  under_review:     { label: 'In Review',        color: 'text-info',      bg: 'bg-info/10' },
  submitted:        { label: 'Submitted',        color: 'text-clay-600',  bg: 'bg-clay-100' },
  under_evaluation: { label: 'Evaluating',       color: 'text-clay-600',  bg: 'bg-clay-100' },
  won_direct:       { label: 'Won',              color: 'text-go',        bg: 'bg-go/10' },
  lost_at_rfp:      { label: 'Lost at RFP',      color: 'text-nogo',      bg: 'bg-nogo/10' },
  shortlisted:      { label: 'Shortlisted',      color: 'text-caution',   bg: 'bg-caution/10' },
  cancelled:        { label: 'Cancelled',        color: 'text-smoke-400', bg: 'bg-sand-200' },
}

export const GONOGO_CONFIG: Record<GoNoGoStatus, { label: string; color: string; bg: string; icon: string }> = {
  go:                  { label: 'Go',                  color: 'text-go',        bg: 'bg-go-light',      icon: '✓' },
  pursue_with_caveats: { label: 'Pursue with Caveats', color: 'text-caution',   bg: 'bg-caution-light', icon: '⚠' },
  no_go:               { label: 'No Go',               color: 'text-nogo',      bg: 'bg-nogo-light',    icon: '✗' },
  pending:             { label: 'Pending',             color: 'text-smoke-500', bg: 'bg-sand-200',      icon: '·' },
}

export const DOC_STATUS_CONFIG: Record<DocumentStatus, { label: string; color: string }> = {
  uploading:  { label: 'Uploading',   color: 'text-smoke-400' },
  processing: { label: 'Processing',  color: 'text-caution' },
  completed:  { label: 'Ready',       color: 'text-go' },
  failed:     { label: 'Failed',      color: 'text-nogo' },
}

export function getCFAVColor(score: number | null): string {
  if (score === null) return 'text-smoke-400'
  if (score >= 65) return 'text-go'
  if (score >= 45) return 'text-caution'
  return 'text-nogo'
}

export function getCFAVBg(score: number | null): string {
  if (score === null) return 'bg-sand-200'
  if (score >= 65) return 'bg-go-light'
  if (score >= 45) return 'bg-caution-light'
  return 'bg-nogo-light'
}

export const INDUSTRY_LABELS: Record<string, string> = {
  retail:              'Retail',
  financial_services:  'Financial Services',
  healthcare:          'Healthcare',
  public_sector:       'Public Sector',
  manufacturing:       'Manufacturing',
  technology:          'Technology',
  energy:              'Energy & Utilities',
  telecoms:            'Telecoms',
  transport:           'Transport & Logistics',
  education:           'Education',
  media:               'Media & Entertainment',
  other:               'Other',
}

// Sub-domains per industry vertical
export const INDUSTRY_SUBDOMAINS: Record<string, Array<{ value: string; label: string }>> = {
  retail: [
    { value: 'point_of_sale',        label: 'Point of Sale' },
    { value: 'ecommerce',            label: 'eCommerce & Digital' },
    { value: 'consumer_goods',       label: 'Consumer Goods' },
    { value: 'repairs_aftercare',    label: 'Repairs & Aftercare' },
    { value: 'supply_chain',         label: 'Supply Chain & Logistics' },
    { value: 'loyalty_crm',          label: 'Loyalty & CRM' },
    { value: 'store_operations',     label: 'Store Operations' },
    { value: 'merchandising',        label: 'Merchandising & Pricing' },
    { value: 'other',                label: 'Other' },
  ],
  financial_services: [
    { value: 'retail_banking',       label: 'Retail Banking' },
    { value: 'investment_banking',   label: 'Investment Banking' },
    { value: 'insurance',            label: 'Insurance' },
    { value: 'wealth_management',    label: 'Wealth Management' },
    { value: 'payments',             label: 'Payments & FinTech' },
    { value: 'risk_compliance',      label: 'Risk & Compliance' },
    { value: 'capital_markets',      label: 'Capital Markets' },
    { value: 'other',                label: 'Other' },
  ],
  healthcare: [
    { value: 'nhs_primary',          label: 'NHS Primary Care' },
    { value: 'nhs_secondary',        label: 'NHS Secondary / Acute' },
    { value: 'mental_health',        label: 'Mental Health' },
    { value: 'social_care',          label: 'Social Care' },
    { value: 'pharma',               label: 'Pharmaceuticals' },
    { value: 'med_devices',          label: 'Medical Devices' },
    { value: 'health_data',          label: 'Health Data & Analytics' },
    { value: 'other',                label: 'Other' },
  ],
  public_sector: [
    { value: 'central_government',   label: 'Central Government' },
    { value: 'local_government',     label: 'Local Government' },
    { value: 'defence',              label: 'Defence' },
    { value: 'justice_policing',     label: 'Justice & Policing' },
    { value: 'housing',              label: 'Housing' },
    { value: 'digital_services',     label: 'Digital Public Services' },
    { value: 'other',                label: 'Other' },
  ],
  manufacturing: [
    { value: 'automotive',           label: 'Automotive' },
    { value: 'aerospace',            label: 'Aerospace & Defence' },
    { value: 'industrial',           label: 'Industrial & Heavy Engineering' },
    { value: 'fmcg',                 label: 'FMCG' },
    { value: 'electronics',          label: 'Electronics' },
    { value: 'chemicals',            label: 'Chemicals' },
    { value: 'other',                label: 'Other' },
  ],
  technology: [
    { value: 'cloud_infrastructure', label: 'Cloud & Infrastructure' },
    { value: 'cyber_security',       label: 'Cyber Security' },
    { value: 'data_analytics',       label: 'Data & Analytics' },
    { value: 'ai_ml',                label: 'AI & Machine Learning' },
    { value: 'software_dev',         label: 'Software Development' },
    { value: 'erp_crm',              label: 'ERP / CRM' },
    { value: 'iot',                  label: 'IoT & Connected Devices' },
    { value: 'other',                label: 'Other' },
  ],
  energy: [
    { value: 'oil_gas',              label: 'Oil & Gas' },
    { value: 'renewables',           label: 'Renewables' },
    { value: 'utilities',            label: 'Water & Utilities' },
    { value: 'smart_grid',           label: 'Smart Grid & Metering' },
    { value: 'nuclear',              label: 'Nuclear' },
    { value: 'other',                label: 'Other' },
  ],
  telecoms: [
    { value: 'mobile',               label: 'Mobile / 5G' },
    { value: 'broadband',            label: 'Broadband & Fixed Line' },
    { value: 'oss_bss',              label: 'OSS / BSS' },
    { value: 'network_infra',        label: 'Network Infrastructure' },
    { value: 'other',                label: 'Other' },
  ],
  transport: [
    { value: 'rail',                 label: 'Rail' },
    { value: 'aviation',             label: 'Aviation' },
    { value: 'road',                 label: 'Road & Highways' },
    { value: 'maritime',             label: 'Maritime & Ports' },
    { value: 'last_mile',            label: 'Last Mile & Delivery' },
    { value: 'fleet_management',     label: 'Fleet Management' },
    { value: 'other',                label: 'Other' },
  ],
  education: [
    { value: 'higher_education',     label: 'Higher Education' },
    { value: 'schools',              label: 'Schools & Academies' },
    { value: 'edtech',               label: 'EdTech & eLearning' },
    { value: 'skills_training',      label: 'Skills & Training' },
    { value: 'other',                label: 'Other' },
  ],
  media: [
    { value: 'broadcast',            label: 'Broadcast & Streaming' },
    { value: 'publishing',           label: 'Publishing' },
    { value: 'gaming',               label: 'Gaming' },
    { value: 'advertising',          label: 'Advertising & Marketing' },
    { value: 'other',                label: 'Other' },
  ],
  other: [
    { value: 'other',                label: 'Other' },
  ],
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin', bid_lead: 'Bid Lead',
  reviewer: 'Reviewer', viewer: 'Viewer',
}
