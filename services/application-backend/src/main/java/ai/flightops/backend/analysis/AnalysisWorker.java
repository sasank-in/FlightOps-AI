package ai.flightops.backend.analysis;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import ai.flightops.backend.analysis.InferenceClient.ScoreResponse;
import ai.flightops.backend.analysis.InferenceClient.ScoreWindow;
import ai.flightops.backend.analysis.InferenceClient.ScoredEvent;
import ai.flightops.backend.config.AppProperties;
import ai.flightops.backend.config.AsyncConfig;
import ai.flightops.backend.flight.TelemetryWindow;
import ai.flightops.backend.flight.TelemetryWindowRepository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientResponseException;

import tools.jackson.databind.json.JsonMapper;

/**
 * Executes analysis runs in the background: scores every window of the flight through the inference
 * API in batches, stores one event per window, and marks the run COMPLETED or FAILED. Failure
 * messages are safe summaries; details go to the log only.
 */
@Component
public class AnalysisWorker {

    private static final Logger log = LoggerFactory.getLogger(AnalysisWorker.class);

    private final AnalysisRunRepository runs;
    private final AnomalyEventRepository events;
    private final TelemetryWindowRepository windows;
    private final InferenceClient inference;
    private final JsonMapper json;
    private final TransactionTemplate tx;
    private final int batchSize;

    public AnalysisWorker(AnalysisRunRepository runs, AnomalyEventRepository events, TelemetryWindowRepository windows,
                          InferenceClient inference, JsonMapper json, TransactionTemplate tx, AppProperties props) {
        this.runs = runs;
        this.events = events;
        this.windows = windows;
        this.inference = inference;
        this.json = json;
        this.tx = tx;
        this.batchSize = Math.max(1, props.inference().batchSize());
    }

    @Async(AsyncConfig.ANALYSIS_EXECUTOR)
    public void execute(long runId) {
        try {
            run(runId);
        } catch (RuntimeException e) {
            log.error("Analysis run {} failed", runId, e);
            fail(runId, safeMessage(e));
        }
    }

    void run(long runId) {
        AnalysisRun run = tx.execute(s -> {
            AnalysisRun r = runs.findById(runId).orElseThrow();
            r.markRunning();
            return r;
        });
        List<TelemetryWindow> flightWindows = windows.findByFlightIdOrderByWindowIndex(run.getFlightId());
        List<AnomalyEvent> scored = new ArrayList<>(flightWindows.size());
        String modelName = null;
        String modelVersion = null;
        Double threshold = null;

        for (int start = 0; start < flightWindows.size(); start += batchSize) {
            List<TelemetryWindow> batch = flightWindows.subList(start, Math.min(start + batchSize, flightWindows.size()));
            List<ScoreWindow> request = batch.stream()
                    .map(w -> new ScoreWindow("f" + w.getFlightId() + "-w" + w.getWindowIndex(),
                            w.getWindowStartSeconds(), json.readTree(w.getData())))
                    .toList();
            ScoreResponse response = inference.score(request);
            if (response == null || response.events() == null || response.events().size() != batch.size()) {
                throw new IllegalStateException("Inference response does not match the request (window count)");
            }
            for (int i = 0; i < batch.size(); i++) {
                TelemetryWindow w = batch.get(i);
                ScoredEvent e = response.events().get(i);
                String expectedId = "f" + w.getFlightId() + "-w" + w.getWindowIndex();
                if (!expectedId.equals(e.flightId())) {
                    throw new IllegalStateException("Inference response events are out of order");
                }
                modelName = e.modelName();
                modelVersion = e.modelVersion();
                threshold = e.threshold();
                scored.add(new AnomalyEvent(runId, w.getWindowIndex(), e.windowStartSeconds(), e.windowEndSeconds(),
                        e.anomalyScore(), e.threshold(), e.anomaly(), evidence(e)));
            }
        }

        String metrics = json.writeValueAsString(metrics(scored));
        String finalModelName = modelName;
        String finalModelVersion = modelVersion;
        Double finalThreshold = threshold;
        tx.executeWithoutResult(s -> {
            events.saveAll(scored);
            runs.findById(runId).orElseThrow().complete(finalModelName, finalModelVersion, finalThreshold, metrics);
        });
    }

    private String evidence(ScoredEvent e) {
        Map<String, Object> ev = new LinkedHashMap<>();
        ev.put("supporting_features", e.supportingFeatures());
        ev.put("quality_flags", e.qualityFlags());
        ev.put("score_components", e.scoreComponents());
        ev.put("interpretation", e.interpretation());
        return json.writeValueAsString(ev);
    }

    private static Map<String, Object> metrics(List<AnomalyEvent> scored) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("n_windows", scored.size());
        m.put("n_above_threshold", scored.stream().filter(AnomalyEvent::isAnomaly).count());
        // null (not NaN) when empty: PostgreSQL jsonb rejects NaN
        var max = scored.stream().mapToDouble(AnomalyEvent::getScore).max();
        var mean = scored.stream().mapToDouble(AnomalyEvent::getScore).average();
        m.put("max_score", max.isPresent() ? max.getAsDouble() : null);
        m.put("mean_score", mean.isPresent() ? mean.getAsDouble() : null);
        return m;
    }

    void fail(long runId, String message) {
        try {
            tx.executeWithoutResult(s -> runs.findById(runId).ifPresent(r -> r.fail(message)));
        } catch (RuntimeException e) {
            log.error("Could not mark analysis run {} as failed", runId, e);
        }
    }

    static String safeMessage(RuntimeException e) {
        if (e instanceof RestClientResponseException r) {
            return "Inference service rejected the request (HTTP " + r.getStatusCode().value() + ")";
        }
        if (e instanceof ResourceAccessException) {
            return "Inference service unavailable or timed out";
        }
        if (e instanceof IllegalStateException && e.getMessage() != null && e.getMessage().startsWith("Inference")) {
            return e.getMessage();
        }
        return "Analysis failed due to an internal error";
    }
}
