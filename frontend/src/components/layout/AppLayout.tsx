import React, { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cn } from '../../lib/utils'
import { useAuth } from '../../app/App'
import { dashboardApi } from '../../lib/api'
import {
  LayoutDashboardIcon, FolderOpenIcon, BookOpenIcon, SettingsIcon, UsersIcon,
  LogOutIcon, ChevronRightIcon, MenuIcon, XIcon, ActivityIcon, ChevronDownIcon
} from '../ui/icons'

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  badge?: number
  roles?: string[]
  key?: string   // allows VS2022 to accept key as a valid prop
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',       label: 'Dashboard',        icon: <LayoutDashboardIcon size={16} /> },
  { to: '/opportunities',   label: 'Opportunities',    icon: <FolderOpenIcon size={16} /> },
  { to: '/knowledge-base',  label: 'Knowledge Base',   icon: <BookOpenIcon size={16} /> },
]

const BOTTOM_NAV: NavItem[] = [
  { to: '/settings/users', label: 'Users',             icon: <UsersIcon size={16} />, roles: ['super_admin'] },
  { to: '/settings',       label: 'Settings',          icon: <SettingsIcon size={16} />, roles: ['super_admin'] },
]

export function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)

  // Live review badge
  const { data: reviewData } = useQuery({
    queryKey: ['my-reviews'],
    queryFn: () => dashboardApi.myReviews().then((r: any) => r.data),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
  const reviewBadge: number | undefined = reviewData?.total > 0 ? reviewData.total : undefined

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const initials = user?.avatar_initials || user?.full_name?.slice(0, 2).toUpperCase() || 'BP'

  return (
    <div className="flex h-screen overflow-hidden bg-sand-100">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-20 bg-ink-500/30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-30 w-56 flex flex-col bg-white border-r border-sand-200 shadow-warm transition-transform duration-300',
        'lg:relative lg:translate-x-0',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      )}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-sand-200">
          <div className="w-7 h-7 rounded-lg gradient-clay flex items-center justify-center flex-shrink-0">
            <span className="text-white text-xs font-bold">B</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-ink-500 truncate leading-tight">AI-Powered</p>
            <p className="text-xs text-smoke-500 truncate leading-tight">Bid Platform</p>
          </div>
          <button className="ml-auto lg:hidden text-smoke-400 hover:text-ink-500" onClick={() => setSidebarOpen(false)}>
            <XIcon size={16} />
          </button>
        </div>

        {/* Main nav */}
        <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto stage-rail">
          {NAV_ITEMS.map((item) => {
            const { to, label, icon, badge, roles } = item
            const liveBadge = to === '/dashboard' ? reviewBadge : badge
            return <SidebarLink key={to} to={to} label={label} icon={icon} badge={liveBadge} roles={roles} onClick={() => setSidebarOpen(false)} />
          })}
        </nav>

        {/* Bottom nav */}
        <div className="px-2 py-2 border-t border-sand-200 space-y-0.5">
          {BOTTOM_NAV.filter(item =>
            !item.roles || item.roles.includes(user?.role || '')
          ).map((item) => {
            const { to, label, icon, badge, roles } = item
            return <SidebarLink key={to} to={to} label={label} icon={icon} badge={badge} roles={roles} onClick={() => setSidebarOpen(false)} />
          })}
        </div>

        {/* Tagline */}
        <div className="px-4 py-2.5 border-t border-sand-100">
          <p className="text-2xs text-smoke-400 italic leading-relaxed">
            Every bid you win<br />teaches the next one how.
          </p>
        </div>

        {/* User */}
        <div className="px-3 py-3 border-t border-sand-200">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-sand-100 transition-colors group"
          >
            <div className="w-7 h-7 rounded-full bg-clay-400 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-semibold">{initials}</span>
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-xs font-medium text-ink-500 truncate">{user?.full_name}</p>
              <p className="text-2xs text-smoke-500 truncate capitalize">{user?.role?.replace('_', ' ')}</p>
            </div>
            <ChevronDownIcon size={12} className={cn('text-smoke-400 transition-transform', userMenuOpen && 'rotate-180')} />
          </button>
          {userMenuOpen && (
            <div className="mt-1 bg-white rounded-lg border border-sand-200 shadow-warm overflow-hidden animate-fade-in">
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-smoke-500 hover:bg-sand-100 hover:text-nogo transition-colors"
              >
                <LogOutIcon size={13} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar (mobile) */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-sand-200 shadow-warm-sm">
          <button onClick={() => setSidebarOpen(true)} className="text-smoke-400 hover:text-ink-500">
            <MenuIcon size={18} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md gradient-clay flex items-center justify-center">
              <span className="text-white text-2xs font-bold">B</span>
            </div>
            <span className="text-sm font-semibold text-ink-500">Bid Platform</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function SidebarLink({ to, label, icon, badge, onClick }: NavItem & { onClick?: () => void; key?: string }) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) => cn(
        'group flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150',
        'relative',
        isActive
          ? 'bg-clay-50 text-clay-600 font-medium'
          : 'text-smoke-500 hover:bg-sand-100 hover:text-ink-500'
      )}
    >
      {({ isActive }) => (
        <>
          {/* Stage indicator dot */}
          <div className={cn(
            'relative z-10 flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0 transition-all',
            isActive ? 'bg-clay-400 text-white' : 'text-smoke-400 group-hover:text-smoke-600'
          )}>
            {icon}
          </div>
          <span className="flex-1 truncate">{label}</span>
          {badge !== undefined && badge > 0 && (
            <span className="text-2xs font-semibold bg-clay-400 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
              {badge}
            </span>
          )}
          {isActive && <ChevronRightIcon size={12} className="text-clay-400 flex-shrink-0" />}
        </>
      )}
    </NavLink>
  )
}
