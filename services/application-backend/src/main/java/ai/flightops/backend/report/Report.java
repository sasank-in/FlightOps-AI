package ai.flightops.backend.report;

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

/** An engineering report for one completed analysis run (V2__reports.sql). */
@Entity
@Table(name = "reports")
public class Report {

    public enum Status { PENDING, RUNNING, COMPLETED, FAILED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "analysis_run_id", nullable = false)
    private Long analysisRunId;

    @Column(name = "flight_id", nullable = false)
    private Long flightId;

    @Column(name = "requested_by", nullable = false)
    private Long requestedBy;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status = Status.PENDING;

    @Column(length = 16)
    private String generator;

    @Column(name = "llm_provider", length = 32)
    private String llmProvider;

    @Column(name = "llm_model", length = 128)
    private String llmModel;

    @Column(name = "prompt_version", length = 16)
    private String promptVersion;

    @Column(name = "evidence_json", columnDefinition = "jsonb")
    @ColumnTransformer(write = "?::jsonb")
    private String evidenceJson;

    @Column(name = "content_json", columnDefinition = "jsonb")
    @ColumnTransformer(write = "?::jsonb")
    private String contentJson;

    @Column(name = "content_md", columnDefinition = "text")
    private String contentMd;

    @Column(name = "fallback_reason", length = 300)
    private String fallbackReason;

    @Column(name = "error_message", length = 500)
    private String errorMessage;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "completed_at")
    private Instant completedAt;

    protected Report() {}

    public Report(Long analysisRunId, Long flightId, Long requestedBy) {
        this.analysisRunId = analysisRunId;
        this.flightId = flightId;
        this.requestedBy = requestedBy;
    }

    public void markRunning() {
        this.status = Status.RUNNING;
    }

    public void complete(String generator, String llmProvider, String llmModel, String promptVersion,
                         String evidenceJson, String contentJson, String contentMd, String fallbackReason) {
        this.status = Status.COMPLETED;
        this.generator = generator;
        this.llmProvider = llmProvider;
        this.llmModel = llmModel;
        this.promptVersion = promptVersion;
        this.evidenceJson = evidenceJson;
        this.contentJson = contentJson;
        this.contentMd = contentMd;
        this.fallbackReason = truncate(fallbackReason, 300);
        this.completedAt = Instant.now();
    }

    public void fail(String safeMessage) {
        this.status = Status.FAILED;
        this.errorMessage = truncate(safeMessage, 500);
        this.completedAt = Instant.now();
    }

    private static String truncate(String s, int max) {
        return s == null ? null : s.substring(0, Math.min(s.length(), max));
    }

    public Long getId() { return id; }
    public Long getAnalysisRunId() { return analysisRunId; }
    public Long getFlightId() { return flightId; }
    public Long getRequestedBy() { return requestedBy; }
    public Status getStatus() { return status; }
    public String getGenerator() { return generator; }
    public String getLlmProvider() { return llmProvider; }
    public String getLlmModel() { return llmModel; }
    public String getPromptVersion() { return promptVersion; }
    public String getEvidenceJson() { return evidenceJson; }
    public String getContentJson() { return contentJson; }
    public String getContentMd() { return contentMd; }
    public String getFallbackReason() { return fallbackReason; }
    public String getErrorMessage() { return errorMessage; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getCompletedAt() { return completedAt; }
}
