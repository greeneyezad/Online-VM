import React, { useState, useEffect, useRef } from 'react'
import { UploadCloud, Trash2, HardDrive, RefreshCw } from 'lucide-react'
import { getISOs, uploadISO, deleteISO } from '../api/client'

export default function ISOManager() {
  const [isos, setIsos] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadFilename, setUploadFilename] = useState('')
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const fileInputRef = useRef(null)

  async function fetchISOs() {
    try {
      const data = await getISOs()
      setIsos(data)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to load ISOs')
    }
  }

  useEffect(() => { fetchISOs() }, [])

  async function handleUpload(file) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.iso')) {
      setError('Only .iso files are accepted')
      return
    }
    setError(null)
    setUploading(true)
    setUploadProgress(0)
    setUploadFilename(file.name)

    const formData = new FormData()
    formData.append('file', file)

    try {
      await uploadISO(formData, (progressEvent) => {
        const pct = Math.round((progressEvent.loaded / progressEvent.total) * 100)
        setUploadProgress(pct)
      })
      await fetchISOs()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Upload failed')
    } finally {
      setUploading(false)
      setUploadFilename('')
      setUploadProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleFileInputChange(e) {
    const file = e.target.files?.[0]
    if (file) handleUpload(file)
  }

  function handleDragEnter(e) { e.preventDefault(); setDragOver(true) }
  function handleDragLeave(e) { e.preventDefault(); setDragOver(false) }
  function handleDragOver(e) { e.preventDefault() }
  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleUpload(file)
  }

  async function handleDelete(filename) {
    setError(null)
    try {
      await deleteISO(filename)
      await fetchISOs()
    } catch (err) {
      setError(err?.response?.data?.detail || 'Delete failed')
    } finally {
      setConfirmDelete(null)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>ISO Library</h1>
        <button className="btn-secondary" onClick={fetchISOs}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Upload zone */}
      <div
        className={`upload-zone${dragOver ? ' drag-over' : ''}`}
        style={{ marginBottom: '1.5rem' }}
        onClick={() => !uploading && fileInputRef.current?.click()}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <UploadCloud size={40} color={dragOver ? 'var(--accent)' : 'var(--text-secondary)'} />
        <p style={{ marginTop: '0.75rem', fontSize: '0.95rem', color: 'var(--text-primary)' }}>
          {uploading ? `Uploading ${uploadFilename}…` : 'Click or drag an ISO file here to upload'}
        </p>
        <p>.iso files only</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".iso"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
      </div>

      {/* Progress bar */}
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

      {/* Error */}
      {error && <div className="error-banner">{error}</div>}

      {/* ISO table */}
      {isos.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Path</th>
                <th style={{ width: '100px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isos.map(iso => (
                <tr key={iso.name}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <HardDrive size={15} color="var(--accent)" />
                      <span style={{ fontWeight: 500 }}>{iso.name}</span>
                    </div>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{iso.size_human}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontFamily: 'monospace' }}>{iso.path}</td>
                  <td>
                    {confirmDelete === iso.name ? (
                      <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <button
                          className="btn-danger"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}
                          onClick={() => handleDelete(iso.name)}
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
                        title="Delete ISO"
                        style={{ color: 'var(--error)' }}
                        onClick={() => setConfirmDelete(iso.name)}
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
            <HardDrive size={48} color="var(--border)" />
            <h3>No ISO images</h3>
            <p>Upload an ISO to get started</p>
          </div>
        )
      )}
    </div>
  )
}
