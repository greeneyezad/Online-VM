import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Play, Square, Pause, Monitor, Settings, Trash2,
  Cpu, MemoryStick, HardDrive, RotateCcw, Disc, Download
} from 'lucide-react'
import ExportVMModal from './ExportVMModal'

function formatRAM(mb) {
  if (mb < 1024) return `${mb} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>
}

export default function VMCard({ vm, onStart, onStop, onPause, onResume, onReset, onDelete, onOpenConsole }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showExport, setShowExport] = useState(false)

  const isRunning = vm.status === 'running'
  const isStopped = vm.status === 'stopped'
  const isPaused = vm.status === 'paused'
  const isError = vm.status === 'error'

  const isoFilename = vm.iso_path ? vm.iso_path.split('/').pop() : null

  return (
    <div className={`vm-card${isRunning ? ' running' : ''}`}>
      {/* Header */}
      <div className="vm-card-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <span className={`status-dot ${vm.status}`} />
          <div style={{ minWidth: 0 }}>
            <div className="vm-card-title">{vm.name}</div>
            {vm.description && (
              <div className="vm-card-desc" title={vm.description}>{vm.description}</div>
            )}
          </div>
        </div>
        <StatusBadge status={vm.status} />
      </div>

      {/* Specs */}
      <div className="vm-specs">
        <span className="vm-spec">
          <Cpu size={13} />
          {vm.cpu_cores} vCPU
        </span>
        <span className="vm-spec">
          <MemoryStick size={13} />
          {formatRAM(vm.ram_mb)}
        </span>
        <span className="vm-spec">
          <HardDrive size={13} />
          {vm.disk_size_gb} GB
        </span>
      </div>

      {/* ISO chip */}
      {isoFilename && (
        <div>
          <span className="iso-chip">
            <Disc size={11} />
            {isoFilename}
          </span>
        </div>
      )}

      {/* Tags */}
      {vm.tags && vm.tags.length > 0 && (
        <div className="vm-tags">
          {vm.tags.map(tag => (
            <span key={tag} className="vm-tag">{tag}</span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="vm-actions">
        {/* Start */}
        <button
          className="btn-icon"
          title="Start"
          style={{ color: (!isRunning && !isPaused) ? 'var(--success)' : undefined }}
          onClick={() => onStart && onStart(vm.id)}
          disabled={isRunning || isPaused}
        >
          <Play size={14} />
        </button>

        {/* Stop */}
        <button
          className="btn-icon"
          title="Stop"
          style={{ color: !isStopped ? 'var(--error)' : undefined }}
          onClick={() => onStop && onStop(vm.id)}
          disabled={isStopped || isError}
        >
          <Square size={14} />
        </button>

        {/* Pause / Resume */}
        {isPaused ? (
          <button
            className="btn-icon"
            title="Resume"
            style={{ color: 'var(--warning)' }}
            onClick={() => onResume && onResume(vm.id)}
          >
            <Play size={14} />
          </button>
        ) : (
          <button
            className="btn-icon"
            title="Pause"
            style={{ color: isRunning ? 'var(--warning)' : undefined }}
            onClick={() => onPause && onPause(vm.id)}
            disabled={isStopped || isError}
          >
            <Pause size={14} />
          </button>
        )}

        {/* Reset */}
        <button
          className="btn-icon"
          title="Reset"
          onClick={() => onReset && onReset(vm.id)}
          disabled={!isRunning}
        >
          <RotateCcw size={14} />
        </button>

        {/* Console */}
        <button
          className="btn-icon"
          title="Open console"
          onClick={() => onOpenConsole && onOpenConsole(vm.id)}
          disabled={isStopped || isError}
        >
          <Monitor size={14} />
        </button>

        {/* Export */}
        <button
          className="btn-icon"
          title={isStopped ? 'Export VM' : 'Stop the VM to export it'}
          onClick={() => setShowExport(true)}
          disabled={!isStopped}
        >
          <Download size={14} />
        </button>

        {/* Settings */}
        <Link to={`/vm/${vm.id}/settings`} className="btn-icon" title="VM settings">
          <Settings size={14} />
        </Link>

        {/* Delete */}
        {confirmDelete ? (
          <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Delete?</span>
            <button
              className="btn-danger"
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}
              onClick={() => { onDelete && onDelete(vm.id); setConfirmDelete(false) }}
            >
              Yes
            </button>
            <button
              className="btn-secondary"
              style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem' }}
              onClick={() => setConfirmDelete(false)}
            >
              No
            </button>
          </div>
        ) : (
          <button
            className="btn-icon"
            title="Delete VM"
            style={{ marginLeft: 'auto', color: 'var(--error)' }}
            onClick={() => setConfirmDelete(true)}
            disabled={isRunning}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <ExportVMModal vm={vm} isOpen={showExport} onClose={() => setShowExport(false)} />
    </div>
  )
}
