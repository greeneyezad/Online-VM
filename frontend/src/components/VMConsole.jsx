import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Monitor, ChevronLeft, ExternalLink, Play, Square, Maximize2 } from 'lucide-react'
import { getVM, startVM, stopVM } from '../api/client'

export default function VMConsole() {
  const { id: vmId } = useParams()
  const navigate = useNavigate()
  const [vm, setVM] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState(false)

  async function fetchVM() {
    setLoading(true)
    setError(null)
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
    fetchVM()
  }, [vmId])

  async function handleStart() {
    setActionLoading(true)
    try {
      await startVM(vmId)
      await fetchVM()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to start VM')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleStop() {
    setActionLoading(true)
    try {
      await stopVM(vmId)
      await fetchVM()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to stop VM')
    } finally {
      setActionLoading(false)
    }
  }

  const isRunning = vm?.status === 'running'
  const isStopped = vm?.status === 'stopped' || vm?.status === 'error'

  const hostname = window.location.hostname
  const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80')
  const wsEndpoint = `ws://${hostname}:${port}/ws/vnc/${vmId}`
  const noVNCUrl = `https://novnc.com/noVNC/vnc.html?host=${hostname}&port=${port}&path=ws/vnc/${vmId}`

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
            <button className="btn-secondary" onClick={handleStop} disabled={actionLoading}>
              <Square size={14} />
              Stop
            </button>
          ) : (
            <button className="btn-primary" onClick={handleStart} disabled={actionLoading}>
              {actionLoading ? <span className="spinner" /> : <Play size={14} />}
              Start
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {/* Stopped state */}
      {isStopped && (
        <div className="empty-state card" style={{ minHeight: '260px' }}>
          <Monitor size={56} color="var(--border)" />
          <h3>{vm?.name}</h3>
          <p>Start the VM to connect to the console</p>
          <button className="btn-primary" onClick={handleStart} disabled={actionLoading}>
            {actionLoading ? <span className="spinner" /> : <Play size={14} />}
            Start VM
          </button>
        </div>
      )}

      {/* Running state */}
      {isRunning && (
        <>
          {/* Connection info */}
          <div className="console-info-card">
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>
              Console Connection
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  WebSocket VNC Endpoint
                </div>
                <code className="console-endpoint">{wsEndpoint}</code>
              </div>
              <div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                  Direct VNC Client
                </div>
                <code className="console-endpoint">{hostname}:{vm?.vnc_port || 5900}</code>
              </div>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <a
                href={noVNCUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
                style={{ textDecoration: 'none' }}
              >
                <ExternalLink size={14} />
                Open in noVNC
              </a>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', alignSelf: 'center' }}>
                VNC Port: {vm?.vnc_port || 5900}
              </span>
            </div>
          </div>

          {/* Console placeholder */}
          <div style={{
            background: '#000',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            minHeight: '320px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: '1rem',
          }}>
            <Monitor size={48} color="#333" />
            <p style={{ color: '#555', fontSize: '0.875rem' }}>
              Use the noVNC button above to open the interactive console
            </p>
          </div>

          {/* Keyboard shortcuts */}
          <div className="keyboard-shortcuts">
            <h3>Keyboard Shortcuts (in noVNC)</h3>
            <ul>
              <li><kbd>Ctrl+Alt+Del</kbd> — Send Ctrl+Alt+Delete to VM</li>
              <li><kbd>Ctrl+Alt+F1</kbd> – <kbd>F7</kbd> — Switch TTY</li>
              <li><kbd>Ctrl+Alt+Backspace</kbd> — Kill X server</li>
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
