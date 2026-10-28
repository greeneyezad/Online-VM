import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Server, Plus, Activity, CheckCircle, XCircle, Database, Upload } from 'lucide-react'
import useVMs from '../hooks/useVMs'
import VMCard from './VMCard'
import CreateVMModal from './CreateVMModal'
import ImportVMModal from './ImportVMModal'

export default function VMList() {
  const { vms, loading, error, refresh, startVM, stopVM, pauseVM, resumeVM, resetVM, deleteVM } = useVMs()
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const navigate = useNavigate()

  const totalVMs = vms.length
  const runningCount = vms.filter(v => v.status === 'running').length
  const stoppedCount = vms.filter(v => v.status === 'stopped').length
  const totalRAMGB = (vms.reduce((sum, v) => sum + (v.ram_mb || 0), 0) / 1024).toFixed(1)

  return (
    <div className="page">
      {/* Page header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <h1>Virtual Machines</h1>
          <span className="badge badge-stopped">{totalVMs}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={() => setShowImportModal(true)}>
            <Upload size={16} />
            Import VM
          </button>
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} />
            Create VM
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="stats-bar">
        <div className="stat-card">
          <Server size={20} color="var(--accent)" />
          <div className="stat-value">{totalVMs}</div>
          <div className="stat-label">Total VMs</div>
        </div>
        <div className="stat-card">
          <Activity size={20} color="var(--success)" />
          <div className="stat-value">{runningCount}</div>
          <div className="stat-label">Running</div>
        </div>
        <div className="stat-card">
          <XCircle size={20} color="var(--text-secondary)" />
          <div className="stat-value">{stoppedCount}</div>
          <div className="stat-label">Stopped</div>
        </div>
        <div className="stat-card">
          <Database size={20} color="var(--warning)" />
          <div className="stat-value">{totalRAMGB} GB</div>
          <div className="stat-label">Total RAM</div>
        </div>
      </div>

      {/* Error */}
      {error && <div className="error-banner">{error}</div>}

      {/* Loading skeletons */}
      {loading && (
        <div className="vm-grid">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      {/* Empty state */}
      {!loading && vms.length === 0 && !error && (
        <div className="empty-state">
          <Server size={56} color="var(--border)" />
          <h3>No virtual machines yet</h3>
          <p>Create your first VM to get started</p>
          <button className="btn-primary" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} />
            Create VM
          </button>
        </div>
      )}

      {/* VM grid */}
      {!loading && vms.length > 0 && (
        <div className="vm-grid">
          {vms.map(vm => (
            <VMCard
              key={vm.id}
              vm={vm}
              onStart={startVM}
              onStop={stopVM}
              onPause={pauseVM}
              onResume={resumeVM}
              onReset={resetVM}
              onDelete={deleteVM}
              onOpenConsole={(id) => navigate(`/vm/${id}`)}
            />
          ))}
        </div>
      )}

      {/* Create VM modal */}
      <CreateVMModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => { setShowCreateModal(false); refresh() }}
      />

      {/* Import VM modal */}
      <ImportVMModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={() => { setShowImportModal(false); refresh() }}
      />
    </div>
  )
}
