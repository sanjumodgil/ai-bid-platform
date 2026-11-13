/**
 * Icon wrapper — use this instead of lucide icons directly.
 * Avoids VS2022 TS2322 className errors on Lucide 0.4xx types.
 *
 * Usage:  <Ic icon={FolderOpen} size={16} className="text-clay-400" />
 *    or:  <FolderOpenIcon size={16} className="text-clay-400" />
 */
import React from 'react'

// ── Generic wrapper ───────────────────────────────────────────────
interface IconProps {
  icon:       any    // the lucide component
  size?:      number
  className?: string
  color?:     string
  strokeWidth?: number
  style?:     React.CSSProperties
}

export function Ic({ icon: IconComponent, size = 16, className, ...rest }: IconProps) {
  return <IconComponent size={size} className={className} {...rest} />
}

// ── Named convenience exports (keeps imports clean in page files) ─
// Each is just Ic with the icon pre-bound.
import {
  FolderOpen, BookOpen, Users, TrendingUp, ArrowRight, AlertCircle,
  Upload, Trash2, RefreshCw, FileText, Server, Zap, Activity, Plus,
  CheckCircle2, Search, Calendar, Building2, Filter, ChevronRight,
  ChevronDown, ChevronLeft, Clock, BarChart2, LayoutDashboard,
  Settings, LogOut, Menu, X, Shield, Database, User, BarChart,
  Download, ClipboardCheck, MessageSquare, Edit, BookOpenCheck,
  PenLine,
} from 'lucide-react'

const make = (icon: any) =>
  ({ size = 16, className, ...p }: Omit<IconProps, 'icon'>) =>
    <Ic icon={icon} size={size} className={className} {...p} />

export const FolderOpenIcon     = make(FolderOpen)
export const BookOpenIcon       = make(BookOpen)
export const UsersIcon          = make(Users)
export const TrendingUpIcon     = make(TrendingUp)
export const ArrowRightIcon     = make(ArrowRight)
export const AlertCircleIcon    = make(AlertCircle)
export const UploadIcon         = make(Upload)
export const Trash2Icon         = make(Trash2)
export const RefreshCwIcon      = make(RefreshCw)
export const FileTextIcon       = make(FileText)
export const ServerIcon         = make(Server)
export const ZapIcon            = make(Zap)
export const ActivityIcon       = make(Activity)
export const PlusIcon           = make(Plus)
export const CheckCircle2Icon   = make(CheckCircle2)
export const SearchIcon         = make(Search)
export const CalendarIcon       = make(Calendar)
export const Building2Icon      = make(Building2)
export const FilterIcon         = make(Filter)
export const ChevronRightIcon   = make(ChevronRight)
export const ChevronDownIcon    = make(ChevronDown)
export const ChevronLeftIcon    = make(ChevronLeft)
export const ClockIcon          = make(Clock)
export const BarChart2Icon      = make(BarChart2)
export const LayoutDashboardIcon= make(LayoutDashboard)
export const SettingsIcon       = make(Settings)
export const LogOutIcon         = make(LogOut)
export const MenuIcon           = make(Menu)
export const XIcon              = make(X)
export const ShieldIcon         = make(Shield)
export const DatabaseIcon       = make(Database)
export const UserIcon           = make(User)
export const BarChartIcon       = make(BarChart)
export const DownloadIcon          = make(Download)
export const ClipboardCheckIcon    = make(ClipboardCheck)
export const MessageSquareIcon     = make(MessageSquare)
export const EditIcon              = make(Edit)
export const BookOpenCheckIcon     = make(BookOpenCheck)
