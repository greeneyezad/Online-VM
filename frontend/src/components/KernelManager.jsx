import React, { useState, useEffect, useRef } from 'react'
import { UploadCloud, Trash2, Cpu, RefreshCw, Terminal } from 'lucide-react'
import { getKernels, uploadKernel, deleteKernel } from '../api/client'

export default function KernelManager() {
  const [kernels, setKernels] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadFilename, setUploadFilename] = useState('')
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const fileInputRef = useRef(null)

  async function fetchKernels() {
    try {
      setKernels(await getKernels())
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to load kernel images')
    }
  }

  useEffect(() => { fetchKernels() }, [])

  async function handleUpload(file) {
    if (!file) return
    setError(null)
    setUploading(true)
    setUploadProgress(0)
    setUploadFilename(file.name)

    const formData = new FormData()
    formData.append('file', file)

    try {
      await uploadKernel(formData, (progressEvent) => {
        const pct = Math.round((progressEvent.loaded / progressEvent.total) * 100)
        setUploadProgress(pct)
      })
      await fetchKernels()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
      setUploadFilename('')
      setUploadProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleUpload(file)
  }

  async function handleDelete(name) {
    setError(null)
    try {
      await deleteKernel(name)
      await fetchKernels()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Delete failed')
    } finally {
      setConfirmDelete(null)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Kernel Library</h1>
        <button className="btn-secondary" onClick={fetchKernels}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div
        className={`upload-zone${dragOver ? ' drag-over' : ''}`}
        style={{ marginBottom: '1.5rem' }}
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragEnter={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={e => { e.preventDefault(); setDragOver(false) }}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}
      >
        <UploadCloud size={40} color={dragOver ? 'var(--accent)' : 'var(--text-secondary)'} />
        <p style={{ marginTop: '0.75rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
          {uploading ? `Uploading ${uploadFilename}…` : 'Click or drag a kernel or initrd image here'}
        </p>
        <p>vmlinuz / bzImage kernels and initrd / initramfs images, any filename</p>
        <input
          ref={fileInputRef}
          type="file"
          style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) handleUpload(file)
          }}
        />
      </div>

      {uploading && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
            <span>{uploadFilename}</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="progress-bar-wrap">
            <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {kernels.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Path</th>
                <th style={{ width: '100px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {kernels.map(k => (
                <tr key={k.name}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {k.kind === 'initrd'
                        ? <Terminal size={15} color="var(--accent)" />
                        : <Cpu size={15} color="var(--accent)" />}
                      <span style={{ fontWeight: 500 }}>{k.name}</span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {k.kind === 'initrd' ? 'initrd' : 'kernel'}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{k.size_human}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontFamily: 'monospace' }}>{k.path}</td>
                  <td>
                    {confirmDelete === k.name ? (
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button
                          className="btn-danger"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}
                          onClick={() => handleDelete(k.name)}
                        >Yes</button>
                        <button
                          className="btn-secondary"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}
                          onClick={() => setConfirmDelete(null)}
                        >No</button>
                      </div>
                    ) : (
                      <button
                        className="btn-icon"
                        title="Delete image"
                        style={{ color: 'var(--error)' }}
                        onClick={() => setConfirmDelete(k.name)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !uploading && (
          <div className="empty-state">
            <Cpu size={48} color="var(--border)" />
            <h3>No kernel images</h3>
            <p>Upload a vmlinuz kernel and an initrd to boot a VM without an installer</p>
          </div>
        )
      )}
    </div>
  )
}
