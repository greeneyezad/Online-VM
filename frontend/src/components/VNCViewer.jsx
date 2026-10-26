import React, { useEffect, useRef, useState } from 'react'
import RFB from '@novnc/novnc'

/**
 * Interactive VNC console for a running VM, embedded in the page.
 *
 * The WebSocket goes through the same origin as the app (the API owns
 * /ws/vnc/{id}), so it works over the preview proxy and keeps TLS when the
 * page is served over HTTPS.
 */
export default function VNCViewer({ vmId, password }) {
  const hostRef = useRef(null)
  const rfbRef = useRef(null)
  const [status, setStatus] = useState('connecting')
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !vmId) return undefined

    setStatus('connecting')
    setError(null)
    host.innerHTML = ''

    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${scheme}://${window.location.host}/ws/vnc/${vmId}`

    let rfb
    try {
      rfb = new RFB(host, url, { credentials: { password: password || undefined } })
    } catch (err) {
      setStatus('error')
      setError(err?.message || 'Could not open the console')
      return undefined
    }

    rfb.scaleViewport = true
    rfb.clipViewport = false
    rfb.background = '#000000'

    rfb.addEventListener('connect', () => setStatus('connected'))
    rfb.addEventListener('disconnect', (event) => {
      setStatus('disconnected')
      if (event.detail && event.detail.clean === false) {
        setError('The console connection closed — the VM may have stopped.')
      }
    })
    rfb.addEventListener('credentialsrequired', () => {
      setError(password ? 'VNC rejected the stored password.' : 'This VM requires a VNC password.')
      setStatus('disconnected')
    })
    rfb.addEventListener('securityfailure', (event) => {
      setError(event.detail?.reason || 'VNC authentication failed')
      setStatus('disconnected')
    })

    rfbRef.current = rfb

    return () => {
      try { rfb.disconnect() } catch (err) { /* already closed */ }
      rfbRef.current = null
      host.innerHTML = ''
    }
  }, [vmId, password, attempt])

  function toggleFullscreen() {
    const stage = hostRef.current?.parentElement
    if (!stage) return
    if (document.fullscreenElement) document.exitFullscreen()
    else stage.requestFullscreen?.()
  }

  return (
    <div className="vnc-wrap">
      <div className="vnc-toolbar">
        <span className={`vnc-status vnc-status-${status}`}>{status}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn-secondary"
            onClick={() => rfbRef.current?.sendCtrlAltDel()}
            disabled={status !== 'connected'}
          >
            Ctrl+Alt+Del
          </button>
          <button className="btn-secondary" onClick={toggleFullscreen}>Fullscreen</button>
          <button className="btn-secondary" onClick={() => setAttempt(a => a + 1)}>Reconnect</button>
        </div>
      </div>

      <div className="vnc-stage">
        <div className="vnc-surface" ref={hostRef} />
        {status !== 'connected' && (
          <div className="vnc-overlay">
            {status === 'connecting' ? (
              <>
                <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
                <p>Connecting to the console…</p>
              </>
            ) : (
              <>
                <p>{error || 'Console disconnected'}</p>
                <button className="btn-primary" onClick={() => setAttempt(a => a + 1)}>Reconnect</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
