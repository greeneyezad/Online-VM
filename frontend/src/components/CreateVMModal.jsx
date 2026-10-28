import React, { useState, useEffect } from 'react'
import { X, RefreshCw } from 'lucide-react'
import { createVM, getISOs, getKernels, getSystemInfo } from '../api/client'
import PortForwardEditor, { normalizePortForwards } from './PortForwardEditor'
import KernelBootEditor from './KernelBootEditor'

const DEFAULT_FORM = {
  name: '',
  description: '',
  tags: [],
  cpu_cores: 2,
  cpu_model: 'host',
  ram_mb: 2048,
  disk_size_gb: 20,
  disk_format: 'qcow2',
  disk_bus: 'virtio',
  disk_cache: 'writeback',
  iso_path: null,
  kernel_path: null,
  initrd_path: null,
  kernel_cmdline: '',
  network_type: 'nat',
  network_interface: 'virtio-net-pci',
  mac_address: '',
  port_forwards: [],
  display_type: 'vnc',
  vnc_password: '',
  boot_order: 'dc',
  enable_kvm: true,
  enable_uefi: false,
  machine_type: 'q35',
  usb_enabled: true,
  sound_enabled: false,
  sound_model: 'ich9-intel-hda',
  nested_virt: false,
  enable_vtpm: false,
}

const TAB_NAMES = ['Basic', 'Hardware', 'Storage', 'Network', 'Display', 'Advanced']

function formatRAM(mb) {
  if (mb < 1024) return `${mb} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle-wrapper">
      <span className="toggle">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
        <span className="toggle-slider" />
      </span>
      <span style={{ fontSize: '0.875rem' }}>{label}</span>
    </label>
  )
}

function RadioCard({ title, desc, selected, onClick }) {
  return (
    <div className={`radio-card${selected ? ' selected' : ''}`} onClick={onClick}>
      <div className="rc-title">{title}</div>
      {desc && <div className="rc-desc">{desc}</div>}
    </div>
  )
}

export default function CreateVMModal({ isOpen, onClose, onCreated }) {
  const [tab, setTab] = useState(0)
  const [form, setForm] = useState(DEFAULT_FORM)
  const [isos, setIsos] = useState([])
  const [kernels, setKernels] = useState([])
  const [system, setSystem] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [tagInput, setTagInput] = useState('')
  // Configure up to the app's 16 GB ceiling; the host still has the final say
  // when the VM starts (QEMU allocates the whole guest RAM up front).
  const maxRam = system?.ram_ceiling_mb || 16384
  const hostMaxRam = system?.max_ram_mb || maxRam

  useEffect(() => {
    if (isOpen) {
      setForm(DEFAULT_FORM)
      setTab(0)
      setError(null)
      setTagInput('')
      fetchISOs()
      fetchKernels()
      fetchSystem()
    }
  }, [isOpen])

  async function fetchSystem() {
    try {
      const data = await getSystemInfo()
      setSystem(data)
      // "host" is a KVM-only CPU model; without KVM fall back to "max".
      if (!data.kvm_available) {
        setForm(f => (f.cpu_model === 'host' ? { ...f, cpu_model: 'max' } : f))
      }
    } catch {
      // non-fatal: the static option lists below are used instead
    }
  }

  async function fetchISOs() {
    try {
      const data = await getISOs()
      setIsos(data)
    } catch {
      // non-fatal
    }
  }

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  async function fetchKernels() {
    try {
      setKernels(await getKernels())
    } catch {
      // non-fatal
    }
  }

  function addTag(value) {
    const tag = value.trim()
    if (tag && !form.tags.includes(tag)) {
      set('tags', [...form.tags, tag])
    }
    setTagInput('')
  }

  function removeTag(tag) {
    set('tags', form.tags.filter(t => t !== tag))
  }

  function handleTagKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    }
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      setError('VM name is required')
      setTab(0)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const payload = { ...form }
      if (!payload.iso_path) payload.iso_path = null
      if (!payload.vnc_password) payload.vnc_password = null
      if (!payload.mac_address) payload.mac_address = null
      if (!payload.kernel_path) {
        payload.initrd_path = null
        payload.kernel_cmdline = ''
      }
      payload.port_forwards = normalizePortForwards(payload.port_forwards)
      await createVM(payload)
      onCreated()
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Failed to create VM')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <h2>Create Virtual Machine</h2>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          {system && (
            <div className={`accel-note${system.kvm_available ? '' : ' accel-note-soft'}`}>
              {system.kvm_available
                ? 'KVM hardware acceleration is available on this host.'
                : 'No KVM on this host — VMs run in software emulation (TCG): they boot and are usable, but slowly.'}
            </div>
          )}

          {/* Tabs */}
          <div className="tabs">
            {TAB_NAMES.map((name, i) => (
              <button key={name} className={`tab${tab === i ? ' active' : ''}`} onClick={() => setTab(i)}>
                {name}
              </button>
            ))}
          </div>

          {error && <div className="error-banner" style={{ marginBottom: '1rem' }}>{error}</div>}

          {/* Tab 0: Basic */}
          {tab === 0 && (
            <div>
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input
                  className="form-input"
                  placeholder="My Linux VM"
                  value={form.name}
                  onChange={e => set('name', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-input"
                  placeholder="Optional description"
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Tags</label>
                <input
                  className="form-input"
                  placeholder="Type tag and press Enter"
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  onBlur={() => tagInput.trim() && addTag(tagInput)}
                />
                {form.tags.length > 0 && (
                  <div className="tags-list">
                    {form.tags.map(tag => (
                      <span key={tag} className="tag-chip">
                        {tag}
                        <button onClick={() => removeTag(tag)}>×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 1: Hardware */}
          {tab === 1 && (
            <div>
              <div className="form-group">
                <label className="form-label">CPU Cores: {form.cpu_cores}</label>
                <input
                  type="range" className="form-range"
                  min={1} max={64} step={1}
                  value={form.cpu_cores}
                  onChange={e => set('cpu_cores', Number(e.target.value))}
                />
                <div className="quick-select">
                  {[1, 2, 4, 8, 16].map(n => (
                    <button
                      key={n}
                      className={form.cpu_cores === n ? 'active' : ''}
                      onClick={() => set('cpu_cores', n)}
                    >{n}</button>
                  ))}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">CPU Model</label>
                <select className="form-select" value={form.cpu_model} onChange={e => set('cpu_model', e.target.value)}>
                  {(system?.cpu_models || ['host', 'qemu64', 'Haswell', 'Skylake-Client', 'EPYC']).map(model => (
                    <option key={model} value={model}>
                      {model === 'host'
                        ? 'host — KVM passthrough (recommended)'
                        : model === 'max'
                          ? 'max — best emulation compatibility'
                          : model}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">RAM: {formatRAM(form.ram_mb)}</label>
                <input
                  type="range" className="form-range"
                  min={512} max={maxRam} step={512}
                  value={form.ram_mb}
                  onChange={e => set('ram_mb', Number(e.target.value))}
                />
                <div className="quick-select">
                  {[512, 1024, 2048, 4096, 8192, 16384].filter(n => n <= maxRam).map(n => (
                    <button
                      key={n}
                      className={form.ram_mb === n ? 'active' : ''}
                      onClick={() => set('ram_mb', n)}
                    >{formatRAM(n)}</button>
                  ))}
                </div>
                {form.ram_mb > hostMaxRam && (
                  <p style={{ fontSize: '0.78rem', color: 'var(--warning, #e0a341)', marginTop: '0.35rem' }}>
                    This host can only allocate {formatRAM(hostMaxRam)} right now — the VM will not start above that.
                  </p>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Machine Type</label>
                <div className="radio-card-group">
                  <RadioCard
                    title="Q35"
                    desc="Modern PCIe, recommended for Linux"
                    selected={form.machine_type === 'q35'}
                    onClick={() => set('machine_type', 'q35')}
                  />
                  <RadioCard
                    title="pc-i440fx"
                    desc="Legacy ISA, for older OSes"
                    selected={form.machine_type === 'pc-i440fx'}
                    onClick={() => set('machine_type', 'pc-i440fx')}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Storage */}
          {tab === 2 && (
            <div>
              <div className="form-group">
                <label className="form-label">Disk Size: {form.disk_size_gb} GB</label>
                <input
                  type="range" className="form-range"
                  min={5} max={500} step={5}
                  value={form.disk_size_gb}
                  onChange={e => set('disk_size_gb', Number(e.target.value))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Disk Format</label>
                <select className="form-select" value={form.disk_format} onChange={e => set('disk_format', e.target.value)}>
                  <option value="qcow2">qcow2 — Dynamic allocation, snapshots supported</option>
                  <option value="raw">raw — Fixed size, slightly faster</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Disk Bus</label>
                <select className="form-select" value={form.disk_bus} onChange={e => set('disk_bus', e.target.value)}>
                  {(system?.disk_buses || ['virtio', 'scsi', 'sata']).map(bus => (
                    <option key={bus} value={bus}>
                      {bus === 'virtio'
                        ? 'VirtIO — fastest (needs guest drivers)'
                        : bus === 'scsi'
                          ? 'SCSI — broad guest support'
                          : 'SATA — widest guest compatibility'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Disk Cache</label>
                <select className="form-select" value={form.disk_cache} onChange={e => set('disk_cache', e.target.value)}>
                  {(system?.disk_cache_modes || ['writeback', 'none', 'writethrough', 'unsafe', 'directsync']).map(mode => (
                    <option key={mode} value={mode}>
                      {mode === 'writeback'
                        ? 'writeback — balanced (default)'
                        : mode === 'none'
                          ? 'none — use host page cache'
                          : mode === 'writethrough'
                            ? 'writethrough — safest, slower'
                            : mode === 'unsafe'
                              ? 'unsafe — fastest, risk of data loss'
                              : mode}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>ISO Image</span>
                  <button className="btn-icon" style={{ width: 'auto', padding: '0.15rem 0.4rem' }} onClick={fetchISOs}>
                    <RefreshCw size={13} />
                  </button>
                </label>
                <select
                  className="form-select"
                  value={form.iso_path || ''}
                  onChange={e => set('iso_path', e.target.value || null)}
                >
                  <option value="">None</option>
                  {isos.map(iso => (
                    <option key={iso.name} value={iso.path}>{iso.name} ({iso.size_human})</option>
                  ))}
                </select>
              </div>
              <KernelBootEditor kernels={kernels} form={form} set={set} />
            </div>
          )}

          {/* Tab 3: Network */}
          {tab === 3 && (
            <div>
              <div className="form-group">
                <label className="form-label">Network Type</label>
                <div className="radio-card-group">
                  <RadioCard title="NAT" desc="Simple, shares host IP" selected={form.network_type === 'nat'} onClick={() => set('network_type', 'nat')} />
                  <RadioCard title="Bridged" desc="Direct network access" selected={form.network_type === 'bridged'} onClick={() => set('network_type', 'bridged')} />
                  <RadioCard title="Host-only" desc="Isolated from internet" selected={form.network_type === 'host-only'} onClick={() => set('network_type', 'host-only')} />
                  <RadioCard title="None" desc="No network adapter" selected={form.network_type === 'none'} onClick={() => set('network_type', 'none')} />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Network Interface</label>
                <select className="form-select" value={form.network_interface} onChange={e => set('network_interface', e.target.value)}>
                  <option value="virtio-net-pci">VirtIO — Recommended</option>
                  <option value="e1000">Intel E1000 — Compatible</option>
                  <option value="rtl8139">Realtek — Legacy</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">MAC Address</label>
                <input
                  className="form-input"
                  placeholder="Auto-generated (52:54:00:xx:xx:xx)"
                  value={form.mac_address || ''}
                  onChange={e => set('mac_address', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Port Forwards (NAT)</label>
                <PortForwardEditor value={form.port_forwards} onChange={v => set('port_forwards', v)} />
              </div>
            </div>
          )}

          {/* Tab 4: Display */}
          {tab === 4 && (
            <div>
              <div className="form-group">
                <label className="form-label">Display Type</label>
                <div className="radio-card-group">
                  <RadioCard title="VNC" desc="Browser console access" selected={form.display_type === 'vnc'} onClick={() => set('display_type', 'vnc')} />
                  <RadioCard title="Headless" desc="No display" selected={form.display_type === 'none'} onClick={() => set('display_type', 'none')} />
                </div>
              </div>
              {form.display_type === 'vnc' && (
                <div className="form-group">
                  <label className="form-label">VNC Password (optional)</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Leave blank for no password"
                    value={form.vnc_password}
                    onChange={e => set('vnc_password', e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Tab 5: Advanced */}
          {tab === 5 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <Toggle
                  checked={form.enable_kvm}
                  onChange={v => set('enable_kvm', v)}
                  label="Enable KVM hardware acceleration (requires KVM on host)"
                />
                {system && !system.kvm_available && (
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                    KVM isn't available here, so QEMU falls back to software emulation (TCG) automatically.
                  </p>
                )}
              </div>
              <Toggle
                checked={form.enable_uefi}
                onChange={v => set('enable_uefi', v)}
                label="Enable UEFI firmware (for modern distros)"
              />
              <div>
                <Toggle
                  checked={form.enable_vtpm}
                  onChange={v => set('enable_vtpm', v)}
                  label="Enable vTPM 2.0 (required by Windows 11 and other modern OSes)"
                />
                {system && !system.vtpm_available && (
                  <p style={{ fontSize: '0.78rem', color: 'var(--error)', marginTop: '0.35rem' }}>
                    swtpm is not installed on this host, so the VM can't start with a vTPM.
                  </p>
                )}
              </div>
              <Toggle
                checked={form.nested_virt}
                onChange={v => set('nested_virt', v)}
                label="Expose hardware virtualization to the guest (nested VMs — needs KVM)"
              />
              <Toggle
                checked={form.usb_enabled}
                onChange={v => set('usb_enabled', v)}
                label="USB Tablet input (recommended for accurate mouse)"
              />
              <Toggle
                checked={form.sound_enabled}
                onChange={v => set('sound_enabled', v)}
                label="Enable sound"
              />
              {form.sound_enabled && (
                <div className="form-group" style={{ marginTop: '-0.5rem' }}>
                  <label className="form-label">Sound Model</label>
                  <select className="form-select" value={form.sound_model} onChange={e => set('sound_model', e.target.value)}>
                    <option value="ich9-intel-hda">Intel HDA (ich9-intel-hda)</option>
                    <option value="ac97">AC97</option>
                    <option value="sb16">SoundBlaster 16</option>
                  </select>
                </div>
              )}
              <div>
                <label className="form-label" style={{ marginBottom: '0.5rem' }}>Boot Order</label>
                <div className="radio-card-group">
                  <RadioCard
                    title="CD-ROM first"
                    desc="CD-ROM → HDD (dc)"
                    selected={form.boot_order === 'dc'}
                    onClick={() => set('boot_order', 'dc')}
                  />
                  <RadioCard
                    title="HDD first"
                    desc="HDD → CD-ROM (cd)"
                    selected={form.boot_order === 'cd'}
                    onClick={() => set('boot_order', 'cd')}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <><span className="spinner" /> Creating...</> : 'Create VM'}
          </button>
        </div>
      </div>
    </div>
  )
}
