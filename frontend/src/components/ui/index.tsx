import React from 'react'
import { cn } from '../../lib/utils'
import { Loader2 } from 'lucide-react'

// ── Button ────────────────────────────────────────────────────────
// Explicitly declare every prop VS2022 needs rather than relying
// on HTMLAttributes inheritance resolution
export interface ButtonProps {
  // Custom props
  variant?:  'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?:     'sm' | 'md' | 'lg'
  loading?:  boolean
  icon?:     React.ReactNode
  // Explicit HTML button props (VS2022 doesn't always resolve via extends)
  children?:   React.ReactNode
  className?:  string
  disabled?:   boolean
  type?:       'button' | 'submit' | 'reset'
  onClick?:    React.MouseEventHandler<HTMLButtonElement>
  onMouseEnter?: React.MouseEventHandler<HTMLButtonElement>
  onMouseLeave?: React.MouseEventHandler<HTMLButtonElement>
  style?:      React.CSSProperties
  id?:         string
  tabIndex?:   number
  title?:      string
  'aria-label'?: string
}

export function Button({
  variant = 'primary', size = 'md', loading, icon,
  children, className, disabled, type = 'button', ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-400 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]'
  const variants = {
    primary:   'bg-clay-400 text-white hover:bg-clay-500 shadow-warm-sm',
    secondary: 'bg-sand-200 text-ink-500 hover:bg-sand-300',
    outline:   'border border-sand-300 bg-white text-ink-500 hover:bg-sand-100',
    ghost:     'text-smoke-500 hover:bg-sand-200 hover:text-ink-500',
    danger:    'bg-nogo text-white hover:bg-red-700',
  }
  const sizes = {
    sm: 'text-xs px-3 py-1.5 h-7',
    md: 'text-sm px-4 py-2 h-9',
    lg: 'text-base px-6 py-2.5 h-11',
  }
  return (
    <button
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <span className="inline-flex"><Loader2 size={16} /></span> : icon}
      {children}
    </button>
  )
}

// ── Input ─────────────────────────────────────────────────────────
export interface InputProps {
  // Custom props
  label?:      string
  error?:      string | any   // accepts string | FieldError | undefined from react-hook-form
  hint?:       string
  icon?:       React.ReactNode
  // Explicit HTML input props
  className?:  string
  placeholder?: string
  type?:       string
  value?:      string | number | readonly string[]
  defaultValue?: string | number | readonly string[]
  disabled?:   boolean
  readOnly?:   boolean
  required?:   boolean
  autoFocus?:  boolean
  autoComplete?: string
  id?:         string
  name?:       string
  min?:        string | number
  max?:        string | number
  minLength?:  number
  maxLength?:  number
  pattern?:    string
  step?:       string | number
  style?:      React.CSSProperties
  tabIndex?:   number
  onChange?:   React.ChangeEventHandler<HTMLInputElement>
  onBlur?:     React.FocusEventHandler<HTMLInputElement>
  onFocus?:    React.FocusEventHandler<HTMLInputElement>
  onKeyDown?:  React.KeyboardEventHandler<HTMLInputElement>
  onKeyUp?:    React.KeyboardEventHandler<HTMLInputElement>
  ref?:        React.Ref<HTMLInputElement>
  'aria-label'?: string
  'aria-describedby'?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, icon, className, ...props }, ref) => {
    const errorMsg = error ? (typeof error === 'string' ? error : error?.message || String(error)) : undefined
    return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-ink-500">{label}</label>}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-smoke-400 pointer-events-none">
            {icon}
          </div>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink-500',
            'placeholder:text-smoke-400 transition-all duration-150',
            'border-sand-300 focus:border-clay-400 focus:ring-2 focus:ring-clay-400/20 focus:outline-none',
            errorMsg && 'border-nogo focus:border-nogo focus:ring-nogo/20',
            icon && 'pl-9',
            className
          )}
          {...props}
        />
      </div>
      {errorMsg && <p className="text-xs text-nogo">{errorMsg}</p>}
      {hint && !errorMsg && <p className="text-xs text-smoke-500">{hint}</p>}
    </div>
  )}
)
Input.displayName = 'Input'

// ── Select ────────────────────────────────────────────────────────
export interface SelectProps {
  label?:    string
  error?:    string
  options:   Array<{ value: string; label: string }>
  className?: string
  value?:    string | number | readonly string[]
  defaultValue?: string | number | readonly string[]
  disabled?: boolean
  required?: boolean
  id?:       string
  name?:     string
  style?:    React.CSSProperties
  onChange?: React.ChangeEventHandler<HTMLSelectElement>
  onBlur?:   React.FocusEventHandler<HTMLSelectElement>
  ref?:      React.Ref<HTMLSelectElement>
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, ...props }, ref) => (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-ink-500">{label}</label>}
      <select
        ref={ref}
        className={cn(
          'w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink-500',
          'border-sand-300 focus:border-clay-400 focus:ring-2 focus:ring-clay-400/20 focus:outline-none',
          'transition-all duration-150 cursor-pointer',
          error && 'border-nogo',
          className
        )}
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {error && <p className="text-xs text-nogo">{error}</p>}
    </div>
  )
)
Select.displayName = 'Select'

// ── Textarea ──────────────────────────────────────────────────────
export interface TextareaProps {
  label?:      string
  error?:      string
  className?:  string
  placeholder?: string
  value?:      string | number | readonly string[]
  defaultValue?: string | number | readonly string[]
  disabled?:   boolean
  readOnly?:   boolean
  required?:   boolean
  rows?:       number
  cols?:       number
  maxLength?:  number
  id?:         string
  name?:       string
  style?:      React.CSSProperties
  onChange?:   React.ChangeEventHandler<HTMLTextAreaElement>
  onBlur?:     React.FocusEventHandler<HTMLTextAreaElement>
  ref?:        React.Ref<HTMLTextAreaElement>
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, ...props }, ref) => (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-ink-500">{label}</label>}
      <textarea
        ref={ref}
        className={cn(
          'w-full rounded-lg border bg-white px-3 py-2 text-sm text-ink-500 resize-none',
          'border-sand-300 focus:border-clay-400 focus:ring-2 focus:ring-clay-400/20 focus:outline-none',
          error && 'border-nogo',
          className
        )}
        {...props}
      />
      {error && <p className="text-xs text-nogo">{error}</p>}
    </div>
  )
)
Textarea.displayName = 'Textarea'

// ── Badge ─────────────────────────────────────────────────────────
interface BadgeProps {
  children:   React.ReactNode
  color?:     string
  bg?:        string
  className?: string
}
export function Badge({ children, color = 'text-smoke-500', bg = 'bg-sand-200', className }: BadgeProps) {
  return (
    <span className={cn('badge', color, bg, className)}>
      {children}
    </span>
  )
}

// ── Card ──────────────────────────────────────────────────────────
interface CardProps {
  children?:   React.ReactNode
  className?:  string
  onClick?:    React.MouseEventHandler<HTMLDivElement>
  style?:      React.CSSProperties
  id?:         string
}
export function Card({ children, className, ...props }: CardProps) {
  return <div className={cn('card', className)} {...props}>{children}</div>
}

// ── Spinner ───────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-flex animate-spin text-clay-400', className)}><Loader2 size={16} /></span>
}

// ── Empty state ───────────────────────────────────────────────────
interface EmptyStateProps {
  icon:         React.ReactNode
  title:        string
  description?: string
  action?:      React.ReactNode
}
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-smoke-300 mb-3">{icon}</div>
      <h3 className="text-sm font-medium text-ink-400 mb-1">{title}</h3>
      {description && <p className="text-xs text-smoke-500 max-w-xs mb-4">{description}</p>}
      {action}
    </div>
  )
}

// ── Progress bar ──────────────────────────────────────────────────
export function ProgressBar({ value, max = 100, className }: {
  value: number; max?: number; className?: string
}) {
  const pct = Math.round((value / max) * 100)
  return (
    <div className={cn('w-full bg-sand-200 rounded-full h-1.5 overflow-hidden', className)}>
      <div
        className="h-full bg-clay-400 rounded-full transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ── CFAV Score Display ────────────────────────────────────────────
import { getCFAVColor, getCFAVBg } from '../../lib/utils'

export function CFAVScore({ score, size = 'md' }: {
  score: number | null; size?: 'sm' | 'md' | 'lg'
}) {
  const sizes = { sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-12 h-12 text-base' }
  if (score === null) return <span className="text-xs text-smoke-400">—</span>
  return (
    <div className={cn('cfav-pill font-semibold', sizes[size], getCFAVColor(score), getCFAVBg(score))}>
      {Math.round(score)}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────
interface SectionHeaderProps {
  title:        string
  description?: string
  action?:      React.ReactNode
}
export function SectionHeader({ title, description, action }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-500">{title}</h2>
        {description && <p className="text-sm text-smoke-500 mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  )
}
