import React, { useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { importVM } from '../api/client'

export default function ImportVMModal({ isOpen, onClose, onImported }) {
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  if (!isOpen) return null

  function reset() {
    setFile(null)
    setName('')
    setProgress(0)
    setError(null)
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function close() {
    if (uploading) return
    reset()
    onClose()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) {
      setError('Choose a .tar.gz archive exported from Online VM')
      return
    }
    setError(null)
    setUploading(true)
    setProgress(0)

    const formData = new FormData()
    formData.append('file', file)
    if (name.trim()) formData.append('name', name.trim())

    try {
      const vm = await importVM(formData, (event) => {
        if (event.total) setProgress(Math.round((event.loaded / event.total) * 100))
      })
      reset()
      onImported(vm)
    } catch (err) {
      setError(err?.response?.data?.detail || 'Import failed')
      setUploading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import VM</h2>
          <button className="btn-icon" onClick={close} disabled={uploading}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Upload an archive exported from Online VM (<code>.tar.gz</code>). The
              imported VM gets a new identity and starts in the stopped state.
            </p>

            <div
              className="upload-zone"
              onClick={() => !uploading && fileInputRef.current?.click()}
            >
              <Upload size={32} color="var(--text-secondary)" />
              <p style={{ marginTop: '0.6rem', color: 'var(--text-primary)' }}>
                {file ? file.name : 'Click to choose an export archive'}
              </p>
              <p>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : '.tar.gz files only'}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".gz,.tgz,.tar.gz,application/gzip"
                style={{ display: 'none' }}
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
            </div>

            <div className="form-group" style={{ marginTop: '1rem' }}>
              <label className="form-label">New name (optional)</label>
              <input
                className="form-input"
                value={name}
                placeholder="Keep the original VM name"
                onChange={e => setName(e.target.value)}
                disabled={uploading}
              />
            </div>

            {uploading && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  <span>Uploading and extracting…</span>
                  <span>{progress}%</span>
                </div>
                <div className="progress-bar-wrap">
                  <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {error && <div className="error-banner" style={{ marginTop: '1rem' }}>{error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={close} disabled={uploading}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={uploading}>
              {uploading ? 'Importing…' : 'Import VM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
