import React, { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Container, Cpu, Layers, Play, RefreshCw, RotateCw,
  ScrollText, Square, X,
} from 'lucide-react'
import {
  dockerAction, getDockerContainers, getDockerImages, getDockerLogs, getDockerStatus,
} from '../api/client'

function formatDate(seconds) {
  if (!seconds) return '—'
  return new Date(seconds * 1000).toLocaleString()
}

function dotClass(state) {
  if (state === 'running') return 'running'
  if (state === 'paused' || state === 'restarting') return 'paused'
  if (state === 'exited' || state === 'created') return 'stopped'
  return 'error'
}

function badgeClass(state) {
  if (state === 'running') return 'badge-running'
  if (state === 'paused' || state === 'restarting') return 'badge-paused'
  if (state === 'exited' || state === 'created') return 'badge-stopped'
  return 'badge-error'
}

export default function DockerManager() {
  const [status, setStatus] = useState(null)
  const [containers, setContainers] = useState([])
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [logs, setLogs] = useState(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const stat = await getDockerStatus()
      setStatus(stat)
      if (!stat.available) {
        setContainers([])
        setImages([])
        return
      }
      const [containerList, imageList] = await Promise.all([
        getDockerContainers(),
        getDockerImages(),
      ])
      setContainers(containerList)
      setImages(imageList)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Could not reach the Docker engine')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 8000)
    return () => clearInterval(timer)
  }, [refresh])

  async function handleAction(container, action) {
    setBusy(`${container.id}:${action}`)
    setError(null)
    try {
      await dockerAction(container.id, action)
      await refresh()
    } catch (err) {
      setError(err?.response?.data?.detail || `Could not ${action} ${container.name}`)
    } finally {
      setBusy(null)
    }
  }

  async function showLogs(container) {
    setError(null)
    try {
      const data = await getDockerLogs(container.id)
      setLogs({ name: container.name, text: data.logs || '(no output)' })
    } catch (err) {
      setError(err?.response?.data?.detail || 'Could not read logs')
    }
  }

  const available = status?.available
  const runningCount = containers.filter(c => c.state === 'running').length

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1>Docker</h1>
          {available && <span className="badge badge-running">{runningCount} running</span>}
        </div>
        <button className="btn-secondary" onClick={refresh}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading && <div className="skeleton" style={{ height: '120px' }} />}

      {!loading && status && !available && (
        <div className="empty-state">
          <AlertTriangle size={48} color="var(--warning)" />
          <h3>Docker engine not available</h3>
          <p>{status.error || 'The API cannot reach a Docker daemon.'}</p>
          <p style={{ fontSize: '0.82rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
            mount {status.socket} into the API container
          </p>
          <p style={{ fontSize: '0.82rem', maxWidth: '460px' }}>
            The rest of the app keeps working: VMs can be created and started without Docker.
          </p>
        </div>
      )}

      {available && (
        <>
          <div className="stats-bar">
            <div className="stat-card">
              <Container size={20} color="var(--accent)" />
              <div className="stat-value">{status.version}</div>
              <div className="stat-label">Engine version</div>
            </div>
            <div className="stat-card">
              <Play size={20} color="var(--success)" />
              <div className="stat-value">{status.containers_running} / {status.containers}</div>
              <div className="stat-label">Containers running</div>
            </div>
            <div className="stat-card">
              <Layers size={20} color="var(--warning)" />
              <div className="stat-value">{status.images}</div>
              <div className="stat-label">Images</div>
            </div>
            <div className="stat-card">
              <Cpu size={20} color="var(--text-secondary)" />
              <div className="stat-value">{status.cpus || '—'} CPU</div>
              <div className="stat-label">{status.os || 'Host'}</div>
            </div>
          </div>

          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0.5rem 0 0.75rem' }}>Containers</h3>
          {containers.length === 0 ? (
            <div className="empty-state">
              <Container size={48} color="var(--border)" />
              <h3>No containers</h3>
              <p>Docker is reachable but no containers exist on this host.</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto', marginBottom: '1.75rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Image</th>
                    <th>Status</th>
                    <th>Ports</th>
                    <th style={{ width: '150px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {containers.map(c => {
                    const startBusy = busy === `${c.id}:start`
                    const stopBusy = busy === `${c.id}:stop`
                    const restartBusy = busy === `${c.id}:restart`
                    return (
                      <tr key={c.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className={`status-dot ${dotClass(c.state)}`} />
                            <span style={{ fontWeight: 500 }}>{c.name}</span>
                            {c.protected && (
                              <span className="vm-tag" title="Runs Online VM itself — actions are disabled">
                                app
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: '0.2rem' }}>
                            {c.short_id}
                          </div>
                        </td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{c.image}</td>
                        <td>
                          <span className={`badge ${badgeClass(c.state)}`}>{c.status || c.state}</span>
                        </td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                          {c.ports || '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.15rem' }}>
                            <button
                              className="btn-icon"
                              title={c.protected ? 'Online VM container — cannot be controlled from here' : 'Start'}
                              style={{ color: c.state !== 'running' ? 'var(--success)' : undefined }}
                              disabled={c.protected || c.state === 'running' || startBusy}
                              onClick={() => handleAction(c, 'start')}
                            >
                              <Play size={14} />
                            </button>
                            <button
                              className="btn-icon"
                              title={c.protected ? 'Online VM container — cannot be controlled from here' : 'Stop'}
                              style={{ color: c.state === 'running' ? 'var(--error)' : undefined }}
                              disabled={c.protected || c.state !== 'running' || stopBusy}
                              onClick={() => handleAction(c, 'stop')}
                            >
                              <Square size={14} />
                            </button>
                            <button
                              className="btn-icon"
                              title={c.protected ? 'Online VM container — cannot be controlled from here' : 'Restart'}
                              disabled={c.protected || restartBusy}
                              onClick={() => handleAction(c, 'restart')}
                            >
                              <RotateCw size={14} />
                            </button>
                            <button
                              className="btn-icon"
                              title="View logs"
                              disabled={busy === `${c.id}:logs`}
                              onClick={() => showLogs(c)}
                            >
                              <ScrollText size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0.5rem 0 0.75rem' }}>Images</h3>
          {images.length === 0 ? (
            <div className="empty-state">
              <Layers size={48} color="var(--border)" />
              <h3>No images</h3>
              <p>Pull an image with the Docker CLI to see it here.</p>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tags</th>
                    <th>Image ID</th>
                    <th>Size</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {images.map(image => (
                    <tr key={image.id}>
                      <td style={{ fontWeight: 500 }}>
                        {image.tags.length > 0 ? image.tags.join(', ') : '—'}
                      </td>
                      <td style={{ fontSize: '0.78rem', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                        {image.short_id}
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{image.size_human}</td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                        {formatDate(image.created)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {logs && (
        <div className="modal-overlay" onClick={() => setLogs(null)}>
          <div className="modal" style={{ maxWidth: '900px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{logs.name} — logs</h2>
              <button className="btn-icon" onClick={() => setLogs(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <pre className="log-view">{logs.text}</pre>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setLogs(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
