import React, { useState } from 'react'
import { Download, X } from 'lucide-react'
import { exportVMUrl } from '../api/client'

export default function ExportVMModal({ vm, isOpen, onClose }) {
  const [includeDisk, setIncludeDisk] = useState(true)

  if (!isOpen || !vm) return null

  function handleExport() {
    const link = document.createElement('a')
    link.href = exportVMUrl(vm.id, includeDisk)
    document.body.appendChild(link)
    link.click()
    link.remove()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export {vm.name}</h2>
          <button className="btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Downloads a <code>.tar.gz</code> archive containing the VM configuration.
            Import it on any Online VM host with <em>Import VM</em>.
          </p>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeDisk}
              onChange={e => setIncludeDisk(e.target.checked)}
              style={{ marginTop: '0.2rem' }}
            />
            <span>
              <span style={{ display: 'block', fontSize: '0.9rem' }}>Include the disk image</span>
              <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Up to {vm.disk_size_gb} GB of virtual disk. Without it, the imported VM gets a fresh empty disk.
              </span>
            </span>
          </label>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleExport}>
            <Download size={16} />
            Download archive
          </button>
        </div>
      </div>
    </div>
  )
}
