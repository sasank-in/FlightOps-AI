/** Types for the application backend (services/application-backend, docs/api-contracts.md). */

export type Role = "ANALYST" | "ADMIN";
export type AnalysisStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface Me {
  id: number;
  username: string;
  role: Role;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface FlightSummary {
  id: number;
  externalFlightReference: string;
  datasetId: string | null;
  nWindows: number;
  ownerId: number;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

export interface WindowInfo {
  windowIndex: number;
  windowStartSeconds: number;
  windowEndSeconds: number;
}

export interface FlightDetail {
  flight: FlightSummary;
  metadata: Record<string, unknown>;
  windows: WindowInfo[];
}

export type Telemetry = Record<string, number[]>;

export interface TelemetryResponse extends WindowInfo {
  flightId: number;
  telemetry: Telemetry;
}

export interface AnalysisMetrics {
  n_windows?: number;
  n_above_threshold?: number;
  max_score?: number | null;
  mean_score?: number | null;
}

export interface Analysis {
  id: number;
  flightId: number;
  status: AnalysisStatus;
  modelName: string | null;
  modelVersion: string | null;
  threshold: number | null;
  startedAt: string;
  completedAt: string | null;
  metrics: AnalysisMetrics;
  error: string | null;
}

export interface SupportingFeature {
  feature: string;
  statistic: string;
  observed_value?: number;
  z_score_vs_nominal_training?: number;
  unit?: string;
  tail_probability_vs_nominal?: number | null;
}

export interface Evidence {
  supporting_features?: SupportingFeature[];
  quality_flags?: Record<string, boolean | number>;
  score_components?: { forest_percentile: number; tail_percentile: number } | null;
  interpretation?: string;
}

export interface AnomalyEvent {
  windowIndex: number;
  windowStartSeconds: number;
  windowEndSeconds: number;
  anomalyScore: number;
  threshold: number;
  isAnomaly: boolean;
  severityLabel: "ABOVE_THRESHOLD" | "BELOW_THRESHOLD";
  evidence: Evidence;
}

export interface Anomalies {
  flightId: number;
  analysisId: number;
  modelName: string;
  modelVersion: string;
  threshold: number;
  nWindows: number;
  nAboveThreshold: number;
  events: AnomalyEvent[];
}

export interface RecentAnalysis {
  analysisId: number;
  flightId: number;
  externalFlightReference: string;
  status: AnalysisStatus;
  startedAt: string;
  completedAt: string | null;
  nWindows: number | null;
  nAboveThreshold: number | null;
}

export interface FlightAlertSummary {
  flightId: number;
  externalFlightReference: string;
  analysisId: number;
  nWindows: number;
  nAboveThreshold: number;
}

export interface Stats {
  flights: number;
  windows: number;
  analysesCompleted: number;
  analysesFailed: number;
  analysesInProgress: number;
  windowsScored: number;
  windowsAboveThreshold: number;
  lastAnalysisAt: string | null;
  recentAnalyses: RecentAnalysis[];
  flightsByAlerts: FlightAlertSummary[];
}

export interface ModelCard {
  model_name: string;
  model_version: string;
  feature_set_version?: string;
  n_features?: number;
  input?: { timesteps: number; sampling_hz: number; variables: string[]; units: Record<string, string> };
  threshold: number;
  score_direction?: string;
  evaluation?: {
    threshold_policy?: string;
    test_precision?: number;
    test_recall?: number;
    test_pr_auc?: number;
    aircraft_held_out_pr_auc_mean?: number;
    report_created_at?: string;
  };
  interpretation?: string;
}

export interface User {
  id: number;
  username: string;
  role: Role;
  enabled: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  username: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  outcome: "SUCCESS" | "DENIED" | "FAILURE";
  detail: string | null;
}

export interface UploadWindow {
  windowStartSeconds: number;
  telemetry: Telemetry;
}

export interface UploadBody {
  externalFlightReference: string;
  datasetId?: string;
  metadata?: Record<string, unknown>;
  windows: UploadWindow[];
}
