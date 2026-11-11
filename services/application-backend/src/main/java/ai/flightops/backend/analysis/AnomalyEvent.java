package ai.flightops.backend.analysis;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.ColumnTransformer;

/** One scored window of an analysis run (documentation.md §15 contract, as returned by the inference API). */
@Entity
@Table(name = "anomaly_events")
public class AnomalyEvent {

    /** Position relative to the model threshold. Deliberately not a safety severity. */
    public static final String ABOVE = "ABOVE_THRESHOLD";
    public static final String BELOW = "BELOW_THRESHOLD";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "analysis_run_id", nullable = false)
    private Long analysisRunId;

    @Column(name = "window_index", nullable = false)
    private int windowIndex;

    @Column(name = "start_offset", nullable = false)
    private int startOffset;

    @Column(name = "end_offset", nullable = false)
    private int endOffset;

    @Column(nullable = false)
    private double score;

    @Column(nullable = false)
    private double threshold;

    @Column(name = "is_anomaly", nullable = false)
    private boolean anomaly;

    @Column(name = "severity_label", nullable = false, length = 24)
    private String severityLabel;

    @Column(name = "evidence_json", nullable = false, columnDefinition = "jsonb")
    @ColumnTransformer(write = "?::jsonb")
    private String evidenceJson;

    protected AnomalyEvent() {}

    public AnomalyEvent(Long analysisRunId, int windowIndex, int startOffset, int endOffset, double score,
                        double threshold, boolean anomaly, String evidenceJson) {
        this.analysisRunId = analysisRunId;
        this.windowIndex = windowIndex;
        this.startOffset = startOffset;
        this.endOffset = endOffset;
        this.score = score;
        this.threshold = threshold;
        this.anomaly = anomaly;
        this.severityLabel = anomaly ? ABOVE : BELOW;
        this.evidenceJson = evidenceJson;
    }

    public Long getId() { return id; }
    public Long getAnalysisRunId() { return analysisRunId; }
    public int getWindowIndex() { return windowIndex; }
    public int getStartOffset() { return startOffset; }
    public int getEndOffset() { return endOffset; }
    public double getScore() { return score; }
    public double getThreshold() { return threshold; }
    public boolean isAnomaly() { return anomaly; }
    public String getSeverityLabel() { return severityLabel; }
    public String getEvidenceJson() { return evidenceJson; }
}
