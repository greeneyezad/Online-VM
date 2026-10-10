import React, { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { RefreshCw, Save, Trash2, Camera, RotateCcw } from 'lucide-react'
import {
  getVM, updateVM, deleteVM, createSnapshot, listSnapshots,
  restoreSnapshot, getISOs,
} from '../api/client'

const TAB_NAMES = ['Basic', 'Hardware', 'Storage', 'Network', 'Display', 'Advanced']

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className="toggle-wrapper" style={{ opacity: disabled ? 0.5 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <span className="toggle">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} />
        <span className="toggle-slider" />
      </span>
      <span style={{ fontSize: '0.875rem' }}>{label}</span>
    </label>
  )
}

function RadioCard({ title, desc, selected, onClick, disabled }) {
  return (
    <div
      className={`radio-card${selected ? ' selected' : ''}`}
      onClick={!disabled ? onClick : undefined}
      style={{ opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <div className="rc-title">{title}</div>
      {desc && <div className="rc-desc">{desc}</div>}
    </div>
  )
}

function formatRAM(mb) {
  if (mb < 1024) return `${mb} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleString()
}

export default function VMSettings() {
  const { id: vmId } = useParams()
  const navigate = useNavigate()

  const [vm, setVM] = useState(null)
  const [form, setForm] = useState({})
  const [tab, setTab] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)
  const [isos, setIsos] = useState([])

  // Snapshots
  const [snapshots, setSnapshots] = useState([])
  const [snapshotName, setSnapshotName] = useState('')
  const [snapshotDesc, setSnapshotDesc] = useState('')
  const [snapshotLoading, setSnapshotLoading] = useState(false)

  // Danger zone
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function fetchVM() {
    try {
      const data = await getVM(vmId)
      setVM(data)
      setForm({
        name: data.name,
        description: data.description,
        tags: data.tags || [],
        cpu_cores: data.cpu_cores,
        cpu_model: data.cpu_model,
        ram_mb: data.ram_mb,
        disk_size_gb: data.disk_size_gb,
        disk_format: data.disk_format,
        iso_path: data.iso_path || null,
        network_type: data.network_type,
        network_interface: data.network_interface,
        display_type: data.display_type,
        vnc_password: data.vnc_password || '',
        boot_order: data.boot_order,
        enable_kvm: data.enable_kvm,
        enable_uefi: data.enable_uefi,
        machine_type: data.machine_type,
        usb_enabled: data.usb_enabled,
        sound_enabled: data.sound_enabled,
        sound_model: data.sound_model,
      })
      setSnapshots(data.snapshots || [])
    } catch (err) {
      setError(err?.response?.data?.detail || 'VM not found')
    }
  }

  async function fetchISOs() {
    try { setIsos(await getISOs()) } catch {}
  }

  useEffect(() => {
    fetchVM()
    fetchISOs()
  }, [vmId])

  function set(key, value) { setForm(f => ({ ...f, [key]: value })) }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = { ...form }
      if (!payload.iso_path) payload.iso_path = null
      if (!payload.vnc_password) payload.vnc_password = null
      await updateVM(vmId, payload)
      await fetchVM()
      showToast('Settings saved')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateSnapshot() {
    if (!snapshotName.trim()) return
    setSnapshotLoading(true)
    try {
      await createSnapshot(vmId, { name: snapshotName, description: snapshotDesc })
      setSnapshotName('')
      setSnapshotDesc('')
      await fetchVM()
      showToast('Snapshot created')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Snapshot failed')
    } finally {
      setSnapshotLoading(false)
    }
  }

  async function handleRestoreSnapshot(snapId) {
    try {
      await restoreSnapshot(vmId, snapId)
      showToast('Snapshot restored')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Restore failed')
    }
  }

  async function handleDeleteVM() {
    if (deleteConfirmName !== vm?.name) return
    setDeleting(true)
    try {
      await deleteVM(vmId)
      navigate('/')
    } catch (err) {
      setError(err?.response?.data?.detail || 'Delete failed')
      setDeleting(false)
    }
  }

  const isRunning = vm?.status === 'running'
  const inputDisabled = isRunning

  if (!vm && !error) {
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
        <div className="breadcrumb"><Link to="/">← Dashboard</Link></div>
        <div className="error-banner">{error}</div>
      </div>
    )
  }

  return (
    <div className="page">
      {/* Breadcrumb */}
      <div className="breadcrumb">
        <Link to="/">← Dashboard</Link>
        <span>/</span>
        <span>{vm.name}</span>
        <span>/</span>
        <span>Settings</span>
      </div>

      {isRunning && (
        <div className="warning-banner">
          Stop the VM before changing settings
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      {/* Tabs */}
      <div className="tabs">
        {TAB_NAMES.map((name, i) => (
          <button key={name} className={`tab${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>
            {name}
          </button>
        ))}
      </div>

      {/* Tab 0: Basic */}
      {tab === 0 && (
        <div>
          <div className="form-group">
            <label className="form-label">Name</label>
            <input className="form-input" value={form.name || ''} onChange={e => set('name', e.target.value)} disabled={inputDisabled} />
          </div>
          <div className="form-group">
            <label className="form-label">Description</label>
            <textarea className="form-input" value={form.description || ''} onChange={e => set('description', e.target.value)} disabled={inputDisabled} />
          </div>
          <div className="form-group">
            <label className="form-label">Tags</label>
            <div className="tags-list" style={{ marginBottom: '0.5rem' }}>
              {(form.tags || []).map(tag => (
                <span key={tag} className="tag-chip">
                  {tag}
                  {!inputDisabled && <button onClick={() => set('tags', form.tags.filter(t => t !== tag))}>×</button>}
                </span>
              ))}
            </div>
            {!inputDisabled && (
              <input
                className="form-input"
                placeholder="Add tag (Enter)"
                onKeyDown={e => {
                  if (e.key === 'Enter' && e.target.value.trim()) {
                    const tag = e.target.value.trim()
                    if (!form.tags.includes(tag)) set('tags', [...form.tags, tag])
                    e.target.value = ''
                  }
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Tab 1: Hardware */}
      {tab === 1 && (
        <div>
          <div className="form-group">
            <label className="form-label">CPU Cores: {form.cpu_cores}</label>
            <input type="range" className="form-range" min={1} max={64} step={1}
              value={form.cpu_cores || 2} onChange={e => set('cpu_cores', Number(e.target.value))} disabled={inputDisabled} />
            <div className="quick-select">
              {[1, 2, 4, 8, 16].map(n => (
                <button key={n} className={form.cpu_cores === n ? 'active' : ''} onClick={() => !inputDisabled && set('cpu_cores', n)} disabled={inputDisabled}>{n}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">CPU Model</label>
            <select className="form-select" value={form.cpu_model || 'host'} onChange={e => set('cpu_model', e.target.value)} disabled={inputDisabled}>
              <option value="host">host (Recommended)</option>
              <option value="qemu64">qemu64</option>
              <option value="Haswell">Haswell</option>
              <option value="Skylake-Client">Skylake-Client</option>
              <option value="EPYC">EPYC</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">RAM: {formatRAM(form.ram_mb || 2048)}</label>
            <input type="range" className="form-range" min={512} max={65536} step={512}
              value={form.ram_mb || 2048} onChange={e => set('ram_mb', Number(e.target.value))} disabled={inputDisabled} />
            <div className="quick-select">
              {[512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].map(n => (
                <button key={n} className={form.ram_mb === n ? 'active' : ''} onClick={() => !inputDisabled && set('ram_mb', n)} disabled={inputDisabled}>{formatRAM(n)}</button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Machine Type</label>
            <div className="radio-card-group">
              <RadioCard title="Q35" desc="Modern PCIe, recommended" selected={form.machine_type === 'q35'} onClick={() => set('machine_type', 'q35')} disabled={inputDisabled} />
              <RadioCard title="pc-i440fx" desc="Legacy ISA" selected={form.machine_type === 'pc-i440fx'} onClick={() => set('machine_type', 'pc-i440fx')} disabled={inputDisabled} />
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Storage */}
      {tab === 2 && (
        <div>
          <div className="form-group">
            <label className="form-label">Disk Size: {form.disk_size_gb} GB</label>
            <input type="range" className="form-range" min={5} max={500} step={5}
              value={form.disk_size_gb || 20} onChange={e => set('disk_size_gb', Number(e.target.value))} disabled={inputDisabled} />
          </div>
          <div className="form-group">
            <label className="form-label">Disk Format</label>
            <select className="form-select" value={form.disk_format || 'qcow2'} onChange={e => set('disk_format', e.target.value)} disabled={inputDisabled}>
              <option value="qcow2">qcow2 — Dynamic allocation, snapshots supported</option>
              <option value="raw">raw — Fixed size, slightly faster</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>ISO Image</span>
              <button className="btn-icon" style={{ width: 'auto', padding: '0.15rem 0.4rem' }} onClick={fetchISOs} disabled={inputDisabled}>
                <RefreshCw size={13} />
              </button>
            </label>
            <select className="form-select" value={form.iso_path || ''} onChange={e => set('iso_path', e.target.value || null)} disabled={inputDisabled}>
              <option value="">None</option>
              {isos.map(iso => (
                <option key={iso.name} value={iso.path}>{iso.name} ({iso.size_human})</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Tab 3: Network */}
      {tab === 3 && (
        <div>
          <div className="form-group">
            <label className="form-label">Network Type</label>
            <div className="radio-card-group">
              <RadioCard title="NAT" desc="Simple, shares host IP" selected={form.network_type === 'nat'} onClick={() => set('network_type', 'nat')} disabled={inputDisabled} />
              <RadioCard title="Bridged" desc="Direct network access" selected={form.network_type === 'bridged'} onClick={() => set('network_type', 'bridged')} disabled={inputDisabled} />
              <RadioCard title="Host-only" desc="Isolated from internet" selected={form.network_type === 'host-only'} onClick={() => set('network_type', 'host-only')} disabled={inputDisabled} />
              <RadioCard title="None" desc="No network adapter" selected={form.network_type === 'none'} onClick={() => set('network_type', 'none')} disabled={inputDisabled} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Network Interface</label>
            <select className="form-select" value={form.network_interface || 'virtio-net-pci'} onChange={e => set('network_interface', e.target.value)} disabled={inputDisabled}>
              <option value="virtio-net-pci">VirtIO — Recommended</option>
              <option value="e1000">Intel E1000 — Compatible</option>
              <option value="rtl8139">Realtek — Legacy</option>
            </select>
          </div>
        </div>
      )}

      {/* Tab 4: Display */}
      {tab === 4 && (
        <div>
          <div className="form-group">
            <label className="form-label">Display Type</label>
            <div className="radio-card-group">
              <RadioCard title="VNC" desc="Browser console access" selected={form.display_type === 'vnc'} onClick={() => set('display_type', 'vnc')} disabled={inputDisabled} />
              <RadioCard title="Headless" desc="No display" selected={form.display_type === 'none'} onClick={() => set('display_type', 'none')} disabled={inputDisabled} />
            </div>
          </div>
          {form.display_type === 'vnc' && (
            <div className="form-group">
              <label className="form-label">VNC Password (optional)</label>
              <input type="password" className="form-input" value={form.vnc_password || ''} onChange={e => set('vnc_password', e.target.value)} disabled={inputDisabled} />
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Advanced */}
      {tab === 5 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <Toggle checked={form.enable_kvm || false} onChange={v => set('enable_kvm', v)} label="Enable KVM hardware acceleration" disabled={inputDisabled} />
          <Toggle checked={form.enable_uefi || false} onChange={v => set('enable_uefi', v)} label="Enable UEFI firmware" disabled={inputDisabled} />
          <Toggle checked={form.usb_enabled || false} onChange={v => set('usb_enabled', v)} label="USB Tablet input" disabled={inputDisabled} />
          <Toggle checked={form.sound_enabled || false} onChange={v => set('sound_enabled', v)} label="Enable sound" disabled={inputDisabled} />
          {form.sound_enabled && (
            <div className="form-group" style={{ marginTop: '-0.5rem' }}>
              <label className="form-label">Sound Model</label>
              <select className="form-select" value={form.sound_model || 'ich9-intel-hda'} onChange={e => set('sound_model', e.target.value)} disabled={inputDisabled}>
                <option value="ich9-intel-hda">Intel HDA (ich9-intel-hda)</option>
                <option value="ac97">AC97</option>
                <option value="sb16">SoundBlaster 16</option>
              </select>
            </div>
          )}
          <div>
            <label className="form-label" style={{ marginBottom: '0.5rem' }}>Boot Order</label>
            <div className="radio-card-group">
              <RadioCard title="CD-ROM first" desc="CD-ROM → HDD (dc)" selected={form.boot_order === 'dc'} onClick={() => set('boot_order', 'dc')} disabled={inputDisabled} />
              <RadioCard title="HDD first" desc="HDD → CD-ROM (cd)" selected={form.boot_order === 'cd'} onClick={() => set('boot_order', 'cd')} disabled={inputDisabled} />
            </div>
          </div>
        </div>
      )}

      {/* Save button */}
      <div style={{ marginTop: '1.5rem' }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving || isRunning}>
          {saving ? <><span className="spinner" /> Saving...</> : <><Save size={14} /> Save Changes</>}
        </button>
      </div>

      {/* ── Snapshots ── */}
      <h2 className="section-title">Snapshots</h2>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          className="form-input"
          style={{ flex: '1', minWidth: '140px' }}
          placeholder="Snapshot name"
          value={snapshotName}
          onChange={e => setSnapshotName(e.target.value)}
        />
        <input
          className="form-input"
          style={{ flex: '2', minWidth: '160px' }}
          placeholder="Description (optional)"
          value={snapshotDesc}
          onChange={e => setSnapshotDesc(e.target.value)}
        />
        <button
          className="btn-primary"
          onClick={handleCreateSnapshot}
          disabled={snapshotLoading || !snapshotName.trim() || !isRunning}
          title={!isRunning ? 'VM must be running to take a snapshot' : ''}
        >
          {snapshotLoading ? <span className="spinner" /> : <Camera size={14} />}
          Create Snapshot
        </button>
      </div>

      {snapshots.length > 0 ? (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Created</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map(snap => (
                <tr key={snap.id}>
                  <td style={{ fontWeight: 500 }}>{snap.name}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{formatDate(snap.created_at)}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{snap.description}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button className="btn-icon" title="Restore" onClick={() => handleRestoreSnapshot(snap.id)}>
                        <RotateCcw size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', padding: '1rem 0' }}>
          No snapshots. Start the VM and create one above.
        </div>
      )}

      {/* ── Danger Zone ── */}
      <div className="danger-zone">
        <h3>Delete Virtual Machine</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1rem' }}>
          This will permanently delete the VM configuration. The disk image at <code>{vm.disk_path}</code> will remain on disk and must be removed manually.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="form-input"
            style={{ maxWidth: '260px' }}
            placeholder={`Type "${vm.name}" to confirm`}
            value={deleteConfirmName}
            onChange={e => setDeleteConfirmName(e.target.value)}
          />
          <button
            className="btn-danger"
            onClick={handleDeleteVM}
            disabled={deleteConfirmName !== vm.name || deleting || isRunning}
          >
            {deleting ? <span className="spinner" /> : <Trash2 size={14} />}
            Delete VM
          </button>
        </div>
      </div>

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
