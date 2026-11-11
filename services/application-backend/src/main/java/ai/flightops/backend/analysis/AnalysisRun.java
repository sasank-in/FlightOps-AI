package ai.flightops.backend.analysis;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.ColumnTransformer;

@Entity
@Table(name = "analysis_runs")
public class AnalysisRun {

    public enum Status { PENDING, RUNNING, COMPLETED, FAILED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "flight_id", nullable = false)
    private Long flightId;

    @Column(name = "requested_by", nullable = false)
    private Long requestedBy;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status = Status.PENDING;

    @Column(name = "model_name", length = 64)
    private String modelName;

    @Column(name = "model_version", length = 32)
    private String modelVersion;

    private Double threshold;

    @Column(name = "started_at", nullable = false, updatable = false)
    private Instant startedAt = Instant.now();

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "metrics_json", columnDefinition = "jsonb")
    @ColumnTransformer(write = "?::jsonb")
    private String metricsJson;

    @Column(name = "error_message", length = 500)
    private String errorMessage;

    protected AnalysisRun() {}

    public AnalysisRun(Long flightId, Long requestedBy) {
        this.flightId = flightId;
        this.requestedBy = requestedBy;
    }

    public void markRunning() {
        this.status = Status.RUNNING;
    }

    public void complete(String modelName, String modelVersion, Double threshold, String metricsJson) {
        this.status = Status.COMPLETED;
        this.modelName = modelName;
        this.modelVersion = modelVersion;
        this.threshold = threshold;
        this.metricsJson = metricsJson;
        this.completedAt = Instant.now();
    }

    public void fail(String safeMessage) {
        this.status = Status.FAILED;
        this.errorMessage = safeMessage == null ? null : safeMessage.substring(0, Math.min(safeMessage.length(), 500));
        this.completedAt = Instant.now();
    }

    public Long getId() { return id; }
    public Long getFlightId() { return flightId; }
    public Long getRequestedBy() { return requestedBy; }
    public Status getStatus() { return status; }
    public String getModelName() { return modelName; }
    public String getModelVersion() { return modelVersion; }
    public Double getThreshold() { return threshold; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getCompletedAt() { return completedAt; }
    public String getMetricsJson() { return metricsJson; }
    public String getErrorMessage() { return errorMessage; }
}
