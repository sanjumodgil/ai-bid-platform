import axios from 'axios'
import { create } from 'zustand'
import type { User, AuthState } from '../types'

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8010'
export const BASE = API_BASE + '/api/v1'

// ── Axios instance ────────────────────────────────────────────────
export const api = axios.create({
  baseURL: BASE,
  headers: { 'Content-Type': 'application/json' },
})

// ── Auth store — NO persist middleware, manual localStorage ───────
// We manage localStorage ourselves so there are no timing/hydration issues
interface AuthStore extends AuthState {
  setAuth: (user: User, access_token: string, refresh_token: string) => void
  clearAuth: () => void
  loadFromStorage: () => boolean
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  access_token: null,
  refresh_token: null,
  isAuthenticated: false,

  setAuth: (user, access_token, refresh_token) => {
    // Write to localStorage synchronously
    localStorage.setItem('bp_token', access_token)
    localStorage.setItem('bp_refresh', refresh_token)
    localStorage.setItem('bp_user', JSON.stringify(user))
    set({ user, access_token, refresh_token, isAuthenticated: true })
  },

  clearAuth: () => {
    localStorage.removeItem('bp_token')
    localStorage.removeItem('bp_refresh')
    localStorage.removeItem('bp_user')
    set({ user: null, access_token: null, refresh_token: null, isAuthenticated: false })
  },

  loadFromStorage: () => {
    const token = localStorage.getItem('bp_token')
    const refresh = localStorage.getItem('bp_refresh')
    const userStr = localStorage.getItem('bp_user')
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr)
        set({ user, access_token: token, refresh_token: refresh, isAuthenticated: true })
        return true
      } catch {}
    }
    return false
  },
}))

// ── Axios interceptors ────────────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('bp_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('bp_token')
      localStorage.removeItem('bp_refresh')
      localStorage.removeItem('bp_user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ── API functions ─────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    axios.post(
      `${BASE}/auth/token`,
      `username=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    ),
  me:               (token?: string) => api.get('/auth/me', token ? { headers: { Authorization: `Bearer ${token}` } } : undefined),
  getAuthConfig:    ()               => api.get('/auth/azure-ad/config'),
  getAzureAdLoginUrl: (redirectUri: string) => api.get(`/auth/azure-ad/login?redirect_uri=${encodeURIComponent(redirectUri)}`),
  azureAdCallback:  (code: string, redirectUri: string) => api.post('/auth/azure-ad/callback', null, { params: { code, redirect_uri: redirectUri } }),
}

export const setupApi = {
  getStatus:       ()                          => api.get('/setup/status'),
  firstRun:        (data: Record<string, any>) => api.post('/setup/first-run', data),
  getConfig:       ()                          => api.get('/setup/config'),
  updateConfig:    (data: Record<string, any>) => api.patch('/setup/config', data),
  getLLMProviders: ()                          => api.get('/setup/llm-providers'),
  addLLMProvider:  (data: Record<string, any>) => api.post('/setup/llm-providers', data),
  health:          ()                          => api.get('/setup/health'),
  infrastructure:  ()                          => api.get('/setup/infrastructure'),
}
export const opportunitiesApi = {
  list:            (params?: Record<string, any>)          => api.get('/opportunities/', { params }),
  create:          (data: Record<string, any>)             => api.post('/opportunities/', data),
  get:             (id: string)                            => api.get(`/opportunities/${id}`),
  update:          (id: string, data: Record<string, any>) => api.patch(`/opportunities/${id}`, data),
  updateCFAV:      (id: string, data: Record<string, any>) => api.post(`/opportunities/${id}/cfav`, data),
  confirmProceed:  (id: string)                            => api.post(`/opportunities/${id}/proceed`),
  getActivity:     (id: string)                            => api.get(`/opportunities/${id}/activity`),
  getRequirements: (id: string)                            => api.get(`/opportunities/${id}/requirements`),
}

export const documentsApi = {
  upload:            (formData: FormData)             => api.post('/documents/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  getStatus:         (id: string)                     => api.get(`/documents/${id}/status`),
  listByOpportunity: (oppId: string)                  => api.get(`/documents/opportunity/${oppId}`),
  listKB:            (params?: Record<string, any>)   => api.get('/documents/knowledge-base/list', { params }),
  delete:            (id: string)                     => api.delete(`/documents/${id}`),
  searchKB:          (query: string, n = 5, opportunityId?: string) =>
    api.post('/documents/knowledge-base/search', { query, n_results: n, opportunity_id: opportunityId }),
  promoteToKB:       (data: Record<string, any>)      => api.post('/documents/promote-to-kb', data),
  reindex:           ()                               => api.post('/documents/reindex'),
  embeddingStatus:   ()                               => api.get('/documents/embedding-status'),
}

export const dashboardApi = {
  stats:     () => api.get('/dashboard/stats'),
  myReviews: () => api.get('/dashboard/my-reviews'),
  auditLog:  (params?: any) => api.get('/dashboard/audit-log', { params }),
}
export const usersApi = {
  list:   ()                                         => api.get('/users/'),
  create: (data: Record<string, any>)                => api.post('/users/', data),
  update: (id: string, data: Record<string, any>)   => api.patch(`/users/${id}`, data),
  delete: (id: string)                               => api.delete(`/users/${id}`),
}

export const integrationsApi = {
  list:         ()                           => api.get('/integrations/'),
  get:          (name: string)               => api.get(`/integrations/${name}`),
  save:         (name: string, data: any)    => api.post(`/integrations/${name}`, { name, ...data }),
  testAzureAD:  ()                           => api.post('/integrations/azure_ad/test'),
  testSMTP:     (data: any)                  => api.post('/integrations/smtp/test', data),
  testLLM:      (data: any)                  => api.post('/integrations/llm/test', data),
  searchAD:     (q: string)                  => api.get('/integrations/azure_ad/search', { params: { q } }),
}

export const bidTeamApi = {
  list:         (oppId: string)              => api.get(`/bid-team/${oppId}`),
  add:          (data: any)                  => api.post('/bid-team/', data),
  update:       (id: string, data: any)      => api.patch(`/bid-team/${id}`, data),
  remove:       (id: string)                 => api.delete(`/bid-team/${id}`),
  bulkAdd:      (oppId: string, names: string, role: string) =>
    api.get(`/bid-team/bulk-add/${oppId}`, { params: { names, role } }),
}

export const kbApi = {
  getContributors:  (docId: string)       => api.get(`/kb/contributors/${docId}`),
  addContributor:   (data: any)           => api.post('/kb/contributors', data),
  removeContributor:(id: string)          => api.delete(`/kb/contributors/${id}`),
  getLesson:        (docId: string)       => api.get(`/kb/lessons/${docId}`),
  upsertLesson:     (data: any)           => api.put('/kb/lessons', data),
  getSummary:       (docId: string)       => api.get(`/kb/summary/${docId}`),
  getFlaggedLessons: (industry?: string)    => api.get('/kb/lessons-flagged', { params: industry ? { industry } : {} }),
}

export const generationApi = {
  initialise:   (oppId: string)                      => api.post(`/generation/${oppId}/initialise`),
  sections:     (oppId: string)                      => api.get(`/generation/${oppId}/sections`),
  streamUrl:    (oppId: string)                      => `${API_BASE}/api/v1/generation/${oppId}/stream`,
  regenerate:   (oppId: string, sectionId: string)   => api.post(`/generation/${oppId}/regenerate/${sectionId}`),
}

export const reviewApi = {
  sections:     (oppId: string, reviewerId?: string) => api.get(`/review/${oppId}/sections`, { params: reviewerId ? { reviewer_id: reviewerId } : {} }),
  getSection:   (sectionId: string)                  => api.get(`/review/section/${sectionId}`),
  assign:       (sectionId: string, data: any)       => api.patch(`/review/section/${sectionId}/assign`, data),
  unassign:     (sectionId: string)                  => api.patch(`/review/section/${sectionId}/unassign`),
  edit:         (sectionId: string, content: string) => api.patch(`/review/section/${sectionId}/edit`, { edited_content: content }),
  decide:       (sectionId: string, decision: string, note?: string) => api.patch(`/review/section/${sectionId}/decide`, { decision, note }),
  addAnnotation:(sectionId: string, data: any)       => api.post(`/review/section/${sectionId}/annotations`, data),
  resolveNote:  (annId: string)                      => api.patch(`/review/annotation/${annId}/resolve`),
  summary:      (oppId: string)                      => api.get(`/review/${oppId}/summary`),
}

export const complianceApi = {
  run:          (oppId: string)                      => api.post(`/compliance/${oppId}/run`),
  results:      (oppId: string)                      => api.get(`/compliance/${oppId}/results`),
}

export const exportApi = {
  preview:        (oppId: string)                    => api.get(`/export/${oppId}/preview`),
  uploadTemplate: (oppId: string, file: File)        => {
    const fd = new FormData(); fd.append('file', file)
    return api.post(`/export/${oppId}/template`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  deleteTemplate: (oppId: string)                    => api.delete(`/export/${oppId}/template`),
  downloadUrl:    (oppId: string, approvedOnly = false) =>
    `${API_BASE}/api/v1/export/${oppId}/download?approved_only=${approvedOnly}`,
  pptxUrl:        (oppId: string) => `${API_BASE}/api/v1/export/${oppId}/pptx`,
}

export const submissionApi = {
  get:            (oppId: string)                    => api.get(`/submission/${oppId}`),
  submit:         (oppId: string, data: any)         => api.post(`/submission/${oppId}/submit`, data),
  capture:        (oppId: string, data: any)         => api.post(`/submission/${oppId}/capture`, data),
  markKBPromoted: (oppId: string)                    => api.patch(`/submission/${oppId}/kb-promoted`),
  markLessons:    (oppId: string)                    => api.patch(`/submission/${oppId}/lessons-added`),
}

export const oralsApi = {
  // Stage 11 — Setup
  get:            (oppId: string)                        => api.get(`/orals/${oppId}`),
  setup:          (oppId: string, data: any)             => api.post(`/orals/${oppId}/setup`, data),
  update:         (oppId: string, data: any)             => api.patch(`/orals/${oppId}/setup`, data),
  // Stage 12 — Slides
  getSlides:      (oppId: string)                        => api.get(`/orals/${oppId}/slides`),
  proposeSlides:  (oppId: string)                        => api.post(`/orals/${oppId}/slides/propose`),
  addSlide:       (oppId: string, data: any)             => api.post(`/orals/${oppId}/slides`, data),
  updateSlide:    (oppId: string, slideId: string, data: any) => api.patch(`/orals/${oppId}/slides/${slideId}`, data),
  deleteSlide:    (oppId: string, slideId: string)       => api.delete(`/orals/${oppId}/slides/${slideId}`),
  generateAllSlidesUrl: (oppId: string)                  => `${API_BASE}/api/v1/orals/${oppId}/slides/generate-all/stream`,
  // Stage 13 — Questions
  getQuestions:   (oppId: string)                        => api.get(`/orals/${oppId}/questions`),
  generateQuestionsUrl: (oppId: string, count: number)   => `${API_BASE}/api/v1/orals/${oppId}/questions/generate/stream?count=${count}`,
  addQuestion:    (oppId: string, data: any)             => api.post(`/orals/${oppId}/questions`, data),
  updateQuestion: (oppId: string, qId: string, data: any) => api.patch(`/orals/${oppId}/questions/${qId}`, data),
  deleteQuestion: (oppId: string, qId: string)           => api.delete(`/orals/${oppId}/questions/${qId}`),
  // Stage 14 — Rehearsals
  getRehearsals:  (oppId: string)                        => api.get(`/orals/${oppId}/rehearsals`),
  addRehearsal:   (oppId: string, data: any)             => api.post(`/orals/${oppId}/rehearsals`, data),
  deleteRehearsal:(oppId: string, rId: string)           => api.delete(`/orals/${oppId}/rehearsals/${rId}`),
  // Stage 15 — Result
  captureResult:  (oppId: string, data: any)             => api.post(`/orals/${oppId}/result`, data),
  // PPTX Export
  pptxUrl:        (oppId: string)                        => `${API_BASE}/api/v1/orals/${oppId}/slides/export-pptx`,
}
