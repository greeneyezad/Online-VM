import React from 'react'
import { Plus, Trash2 } from 'lucide-react'

/**
 * Editor for NAT port forwards (host port -> guest port).
 * Rows with an empty host or guest port are dropped before saving.
 */
export default function PortForwardEditor({ value, onChange }) {
  const rows = value || []

  const update = (index, key, val) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: val } : row)))

  const add = () =>
    onChange([...rows, { protocol: 'tcp', host_port: '', guest_port: '' }])

  const remove = (index) => onChange(rows.filter((_, i) => i !== index))

  return (
    <div>
      {rows.length === 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          No port forwards. Add one to reach a service inside the guest from the host.
        </p>
      )}
      {rows.map((row, index) => (
        <div key={index} style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem', alignItems: 'center' }}>
          <select
            className="form-select"
            style={{ width: '90px' }}
            value={row.protocol || 'tcp'}
            onChange={e => update(index, 'protocol', e.target.value)}
          >
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </select>
          <input
            className="form-input"
            style={{ width: '110px' }}
            type="number"
            min="1"
            max="65535"
            placeholder="Host port"
            value={row.host_port}
            onChange={e => update(index, 'host_port', e.target.value)}
          />
          <span style={{ color: 'var(--text-secondary)' }}>→</span>
          <input
            className="form-input"
            style={{ width: '110px' }}
            type="number"
            min="1"
            max="65535"
            placeholder="Guest port"
            value={row.guest_port}
            onChange={e => update(index, 'guest_port', e.target.value)}
          />
          <button className="btn-icon" title="Remove forward" onClick={() => remove(index)}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }} onClick={add}>
        <Plus size={13} />
        Add port forward
      </button>
    </div>
  )
}

/** Drop incomplete rows and coerce ports to numbers before sending to the API. */
export function normalizePortForwards(rows) {
  return (rows || [])
    .map(row => ({
      protocol: row.protocol === 'udp' ? 'udp' : 'tcp',
      host_port: Number(row.host_port),
      guest_port: Number(row.guest_port),
    }))
    .filter(row => row.host_port > 0 && row.guest_port > 0)
}
