import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import VMList from './components/VMList'
import ISOManager from './components/ISOManager'
import KernelManager from './components/KernelManager'
import VMConsole from './components/VMConsole'
import VMSettings from './components/VMSettings'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('App error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: 'var(--error)' }}>
          <h2>Something went wrong</h2>
          <pre style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {this.state.error?.message}
          </pre>
          <button
            className="btn-primary"
            style={{ marginTop: '1rem' }}
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <Layout>
        <Routes>
          <Route path="/" element={<VMList />} />
          <Route path="/isos" element={<ISOManager />} />
          <Route path="/kernels" element={<KernelManager />} />
          <Route path="/settings" element={<Navigate to="/" replace />} />
          <Route path="/vm/:id" element={<VMConsole />} />
          <Route path="/vm/:id/settings" element={<VMSettings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </ErrorBoundary>
  )
}
