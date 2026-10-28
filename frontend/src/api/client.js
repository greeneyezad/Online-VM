import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export const getSystemInfo = () => api.get('/system').then(r => r.data)
export const getVMs = () => api.get('/vms').then(r => r.data)
export const createVM = (data) => api.post('/vms', data).then(r => r.data)
export const getVM = (id) => api.get(`/vms/${id}`).then(r => r.data)
export const updateVM = (id, data) => api.put(`/vms/${id}`, data).then(r => r.data)
export const deleteVM = (id) => api.delete(`/vms/${id}`).then(r => r.data)
export const startVM = (id) => api.post(`/vms/${id}/start`).then(r => r.data)
export const stopVM = (id) => api.post(`/vms/${id}/stop`).then(r => r.data)
export const forceStopVM = (id) => api.post(`/vms/${id}/force-stop`).then(r => r.data)
export const pauseVM = (id) => api.post(`/vms/${id}/pause`).then(r => r.data)
export const resumeVM = (id) => api.post(`/vms/${id}/resume`).then(r => r.data)
export const resetVM = (id) => api.post(`/vms/${id}/reset`).then(r => r.data)
export const getVMStatus = (id) => api.get(`/vms/${id}/status`).then(r => r.data)
export const createSnapshot = (id, data) => api.post(`/vms/${id}/snapshot`, data).then(r => r.data)
export const listSnapshots = (id) => api.get(`/vms/${id}/snapshots`).then(r => r.data)
export const restoreSnapshot = (id, snap) => api.post(`/vms/${id}/snapshot/${snap}/restore`).then(r => r.data)
export const getISOs = () => api.get('/isos').then(r => r.data)
export const getAIStatus = () => api.get('/ai/status').then(r => r.data)
export const chatWithAI = (messages, page) =>
  api.post('/ai/chat', { messages, page }).then(r => r.data)
export const uploadISO = (formData, onProgress) =>
  api.post('/isos/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  }).then(r => r.data)
export const deleteISO = (name) => api.delete(`/isos/${name}`).then(r => r.data)
export const exportVMUrl = (id, includeDisk = true) =>
  `/api/vms/${id}/export?include_disk=${includeDisk ? 'true' : 'false'}`
export const importVM = (formData, onProgress) =>
  api.post('/vms/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  }).then(r => r.data)
export const getDockerStatus = () => api.get('/docker/status').then(r => r.data)
export const getDockerContainers = () => api.get('/docker/containers').then(r => r.data)
export const getDockerImages = () => api.get('/docker/images').then(r => r.data)
export const dockerAction = (id, action) => api.post(`/docker/containers/${id}/${action}`).then(r => r.data)
export const getDockerLogs = (id, tail = 200) =>
  api.get(`/docker/containers/${id}/logs`, { params: { tail } }).then(r => r.data)
export const getKernels = () => api.get('/kernels').then(r => r.data)
export const uploadKernel = (formData, onProgress) =>
  api.post('/kernels/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  }).then(r => r.data)
export const deleteKernel = (name) => api.delete(`/kernels/${name}`).then(r => r.data)
