import { useState, useEffect, useCallback } from 'react'
import {
  getVMs,
  createVM as apiCreateVM,
  deleteVM as apiDeleteVM,
  startVM as apiStartVM,
  stopVM as apiStopVM,
  pauseVM as apiPauseVM,
  resumeVM as apiResumeVM,
  resetVM as apiResetVM,
  getVMStatus,
} from '../api/client'

export default function useVMs() {
  const [vms, setVMs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchVMs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getVMs()
      setVMs(data)
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Failed to load VMs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchVMs()

    const interval = setInterval(async () => {
      setVMs(prev => {
        const runningVMs = prev.filter(vm => vm.status === 'running')
        if (runningVMs.length === 0) return prev

        // Poll status for running VMs
        runningVMs.forEach(async (vm) => {
          try {
            const status = await getVMStatus(vm.id)
            setVMs(current =>
              current.map(v => v.id === vm.id ? { ...v, status: status.status } : v)
            )
          } catch {
            // silently ignore polling errors
          }
        })
        return prev
      })
    }, 5000)

    return () => clearInterval(interval)
  }, [fetchVMs])

  const withRefresh = (fn) => async (...args) => {
    try {
      await fn(...args)
      await fetchVMs()
    } catch (err) {
      setError(err?.response?.data?.detail || err.message || 'Action failed')
      throw err
    }
  }

  return {
    vms,
    loading,
    error,
    refresh: fetchVMs,
    createVM: withRefresh(apiCreateVM),
    deleteVM: withRefresh(apiDeleteVM),
    startVM: withRefresh(apiStartVM),
    stopVM: withRefresh(apiStopVM),
    pauseVM: withRefresh(apiPauseVM),
    resumeVM: withRefresh(apiResumeVM),
    resetVM: withRefresh(apiResetVM),
  }
}
