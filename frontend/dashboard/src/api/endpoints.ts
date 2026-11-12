import { api } from "./client";
import type {
  Analysis,
  Anomalies,
  AuditEntry,
  FlightDetail,
  FlightSummary,
  Me,
  ModelCard,
  Page,
  Role,
  Stats,
  TelemetryResponse,
  TokenResponse,
  UploadBody,
  User,
} from "./types";

export const endpoints = {
  login: (username: string, password: string) =>
    api<TokenResponse>("/api/v1/auth/login", { method: "POST", body: { username, password }, auth: false }),
  me: () => api<Me>("/api/v1/me"),
  stats: () => api<Stats>("/api/v1/stats"),
  model: () => api<ModelCard>("/api/v1/model"),

  flights: (page: number, size: number, q = "") =>
    api<Page<FlightSummary>>(`/api/v1/flights?page=${page}&size=${size}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  flight: (id: number) => api<FlightDetail>(`/api/v1/flights/${id}`),
  telemetry: (id: number, window: number) => api<TelemetryResponse>(`/api/v1/flights/${id}/telemetry?window=${window}`),
  upload: (body: UploadBody) => api<FlightSummary>("/api/v1/flights/upload", { method: "POST", body }),
  deleteFlight: (id: number) => api<void>(`/api/v1/flights/${id}`, { method: "DELETE" }),

  startAnalysis: (flightId: number) => api<Analysis>(`/api/v1/flights/${flightId}/analyses`, { method: "POST" }),
  analysis: (id: number) => api<Analysis>(`/api/v1/analyses/${id}`),
  analyses: (flightId: number) => api<Analysis[]>(`/api/v1/flights/${flightId}/analyses`),
  anomalies: (flightId: number) => api<Anomalies>(`/api/v1/flights/${flightId}/anomalies`),

  users: () => api<User[]>("/api/v1/users"),
  createUser: (username: string, password: string, role: Role) =>
    api<User>("/api/v1/users", { method: "POST", body: { username, password, role } }),
  setUserEnabled: (id: number, enabled: boolean) => api<User>(`/api/v1/users/${id}`, { method: "PATCH", body: { enabled } }),
  audit: (limit = 100) => api<AuditEntry[]>(`/api/v1/audit?limit=${limit}`),
};
