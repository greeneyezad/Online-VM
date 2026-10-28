import React from 'react'

// Kernel/initrd pickers shared by the create and settings forms.
export default function KernelBootEditor({ kernels, form, set, disabled }) {
  const kernelImages = kernels.filter(k => k.kind !== 'initrd')
  const initrdImages = kernels.filter(k => k.kind === 'initrd')

  return (
    <div>
      <div className="form-group">
        <label className="form-label">Kernel Image (direct boot)</label>
        <select
          className="form-select"
          value={form.kernel_path || ''}
          onChange={e => set('kernel_path', e.target.value || null)}
          disabled={disabled}
        >
          <option value="">None — boot from disk / ISO</option>
          {kernelImages.map(k => (
            <option key={k.name} value={k.path}>{k.name} ({k.size_human})</option>
          ))}
        </select>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
          Boots this kernel directly, skipping the firmware and bootloader. Upload images in the Kernel Library.
        </p>
      </div>

      {form.kernel_path && (
        <>
          <div className="form-group">
            <label className="form-label">Initrd / Initramfs</label>
            <select
              className="form-select"
              value={form.initrd_path || ''}
              onChange={e => set('initrd_path', e.target.value || null)}
              disabled={disabled}
            >
              <option value="">None</option>
              {initrdImages.map(k => (
                <option key={k.name} value={k.path}>{k.name} ({k.size_human})</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Kernel Command Line</label>
            <input
              className="form-input"
              placeholder="console=ttyS0 root=/dev/vda1 rw"
              value={form.kernel_cmdline || ''}
              onChange={e => set('kernel_cmdline', e.target.value)}
              disabled={disabled}
            />
          </div>
        </>
      )}
    </div>
  )
}
