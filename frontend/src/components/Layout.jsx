import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Server, HardDrive, Settings, Monitor, Activity } from 'lucide-react'
import AIAssistant from './AIAssistant'

const PAGE_TITLES = {
  '/': 'Dashboard',
  '/isos': 'ISO Library',
  '/settings': 'Settings',
}

function getPageTitle(pathname) {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname]
  if (pathname.startsWith('/vm/') && pathname.endsWith('/settings')) return 'VM Settings'
  if (pathname.startsWith('/vm/')) return 'VM Console'
  return 'Online VM'
}

export default function Layout({ children }) {
  const location = useLocation()
  const title = getPageTitle(location.pathname)

  return (
    <div className="layout">
      {/* Sidebar */}
      <nav className="sidebar">
        <div className="sidebar-brand">
          <h1>
            <Server size={18} color="var(--accent)" />
            Online VM
          </h1>
        </div>

        <div className="sidebar-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => `sidebar-nav-link${isActive ? ' active' : ''}`}
          >
            <Monitor size={16} />
            Dashboard
          </NavLink>
          <NavLink
            to="/isos"
            className={({ isActive }) => `sidebar-nav-link${isActive ? ' active' : ''}`}
          >
            <HardDrive size={16} />
            ISO Library
          </NavLink>
        </div>

        <div className="sidebar-bottom">
          <NavLink
            to="/settings"
            className={({ isActive }) => `sidebar-nav-link${isActive ? ' active' : ''}`}
          >
            <Settings size={16} />
            Settings
          </NavLink>
        </div>
      </nav>

      {/* Main area */}
      <div className="main-content" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="topbar">
          <h2>{title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={14} color="var(--success)" />
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Online</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {children}
        </div>
      </div>
      <AIAssistant />
    </div>
  )
}
