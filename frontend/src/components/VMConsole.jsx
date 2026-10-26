import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Monitor, Play, Square, Zap } from 'lucide-react'
import { getVM, startVM, stopVM, forceStopVM, getSystemInfo } from '../api/client'
import VNCViewer from './VNCViewer'

export default function VMConsole() {
  const { id: vmId } = useParams()
  const [vm, setVM] = useState(null)
  const [system, setSystem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  async function fetchVM() {
    try {
      const data = await getVM(vmId)
      setVM(data)
    } catch (err) {
      setError(err?.response?.data?.detail || 'VM not found')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    fetchVM()
    getSystemInfo().then(setSystem).catch(() => {})
  }, [vmId])

  async function runAction(action) {
    setActionLoading(true)
    setError(null)
    try {
      await action()
      await fetchVM()
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Action failed')
    } finally {
      setActionLoading(false)
    }
  }

  const isRunning = vm?.status === 'running'

  if (loading) {
    return (
      <div className="page">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '200px' }}>
          <span className="spinner" style={{ width: '24px', height: '24px', borderWidth: '3px' }} />
        </div>
      </div>
    )
  }

  if (error && !vm) {
    return (
      <div className="page">
        <div className="breadcrumb">
          <Link to="/">← Dashboard</Link>
        </div>
        <div className="error-banner">{error}</div>
      </div>
    )
  }

  return (
    <div className="page">
      {/* Breadcrumb + controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div className="breadcrumb" style={{ marginBottom: 0 }}>
          <Link to="/">← Dashboard</Link>
          <span>/</span>
          <span>{vm?.name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className={`badge badge-${vm?.status}`}>{vm?.status}</span>
          {isRunning ? (
            <>
              <button className="btn-secondary" onClick={() => runAction(() => stopVM(vmId))} disabled={actionLoading}>
                <Square size={14} />
                Shut down
              </button>
              <button className="btn-secondary" onClick={() => runAction(() => forceStopVM(vmId))} disabled={actionLoading}>
                <Zap size={14} />
                Force stop
              </button>
            </>
          ) : (
            <button className="btn-primary" onClick={() => runAction(() => startVM(vmId))} disabled={actionLoading}>
              {actionLoading ? <span className="spinner" /> : <Play size={14} />}
              Start
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Console */}
      {isRunning ? (
        <>
          <div className="console-meta">
            <span>{vm.cpu_cores} vCPU</span>
            <span>{vm.ram_mb >= 1024 ? `${(vm.ram_mb / 1024).toFixed(1)} GB` : `${vm.ram_mb} MB`} RAM</span>
            <span>{vm.disk_size_gb} GB disk · {vm.disk_bus}</span>
            <span>VNC :{vm.vnc_port}</span>
            <span>
              {system?.accelerator === 'kvm' ? 'KVM acceleration' : 'Software emulation (TCG)'}
            </span>
          </div>

          {vm.display_type === 'vnc' ? (
            <VNCViewer vmId={vmId} password={vm.vnc_password} />
          ) : (
            <div className="empty-state card" style={{ minHeight: '260px' }}>
              <Monitor size={48} color="var(--border)" />
              <h3>Headless VM</h3>
              <p>This VM has no display enabled. Set the display type to VNC to see its screen here.</p>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state card" style={{ minHeight: '260px' }}>
          <Monitor size={56} color="var(--border)" />
          <h3>{vm?.name}</h3>
          <p>Start the VM to open its console here</p>
          <button className="btn-primary" onClick={() => runAction(() => startVM(vmId))} disabled={actionLoading}>
            {actionLoading ? <span className="spinner" /> : <Play size={14} />}
            Start VM
          </button>
        </div>
      )}

      {/* Keyboard shortcuts */}
      <div className="keyboard-shortcuts">
        <h3>Console tips</h3>
        <ul>
          <li><kbd>Ctrl+Alt+Del</kbd> — send the key combo to the guest (toolbar button)</li>
          <li>Click inside the screen to capture keyboard input</li>
          <li>No bootable medium? Attach an ISO in the VM settings and boot from CD-ROM</li>
        </ul>
      </div>
    </div>
  )
}
