import React, { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Sparkles, X, Send, Wrench, AlertCircle } from 'lucide-react'
import { chatWithAI, getAIStatus } from '../api/client'

export default function AIAssistant() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const bodyRef = useRef(null)

  useEffect(() => {
    getAIStatus()
      .then(setStatus)
      .catch(() => setStatus({ configured: false }))
  }, [])

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, busy, open])

  async function handleSend(event) {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy) return

    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setInput('')
    setError(null)
    setBusy(true)

    try {
      const data = await chatWithAI(
        next.map(({ role, content }) => ({ role, content })),
        location.pathname,
      )
      setMessages([
        ...next,
        { role: 'assistant', content: data.reply, actions: data.actions || [] },
      ])
    } catch (err) {
      setError(err?.response?.data?.detail || 'The assistant could not answer. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const ready = status?.configured

  return (
    <>
      {!open && (
        <button className="ai-fab" onClick={() => setOpen(true)} title="Ask the AI assistant">
          <Sparkles size={18} />
          <span>AI Assistant</span>
        </button>
      )}

      {open && (
        <section className="ai-panel" aria-label="AI assistant">
          <header className="ai-panel-header">
            <div className="ai-panel-title">
              <Sparkles size={16} color="var(--accent)" />
              <strong>AI Assistant</strong>
              {status?.model && ready && <span className="ai-model">{status.model}</span>}
            </div>
            <button className="ai-icon-btn" onClick={() => setOpen(false)} title="Close">
              <X size={16} />
            </button>
          </header>

          <div className="ai-panel-body" ref={bodyRef}>
            {!status && <p className="ai-hint">Checking assistant…</p>}

            {status && !ready && (
              <div className="ai-notice">
                <AlertCircle size={16} />
                <div>
                  <strong>Not configured</strong>
                  <p>
                    Add an <code>OPENAI_API_KEY</code> secret to enable the assistant. It can
                    then inspect your VMs and fix them.
                  </p>
                </div>
              </div>
            )}

            {ready && messages.length === 0 && (
              <div className="ai-empty">
                <p>Describe the problem and I&apos;ll look at the live VM state and fix it.</p>
                <ul>
                  <li>“My VM won’t start”</li>
                  <li>“The guest has no internet”</li>
                  <li>“Why is this VM so slow?”</li>
                </ul>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`ai-msg ai-msg-${msg.role}`}>
                <div className="ai-msg-text">{msg.content}</div>
                {msg.actions?.length > 0 && (
                  <div className="ai-actions">
                    {msg.actions.map((action, j) => (
                      <span
                        key={j}
                        className={`ai-action${action.result?.error ? ' failed' : ''}`}
                        title={JSON.stringify(action.result)}
                      >
                        <Wrench size={11} />
                        {action.tool}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {busy && (
              <div className="ai-msg ai-msg-assistant">
                <div className="ai-msg-text ai-thinking">Checking your VMs…</div>
              </div>
            )}

            {error && <div className="ai-error">{error}</div>}
          </div>

          <form className="ai-panel-footer" onSubmit={handleSend}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ready ? 'Describe the issue…' : 'Assistant is not configured'}
              disabled={!ready || busy}
              aria-label="Message the AI assistant"
            />
            <button type="submit" className="btn-primary" disabled={!ready || busy || !input.trim()}>
              <Send size={15} />
            </button>
          </form>
        </section>
      )}
    </>
  )
}
