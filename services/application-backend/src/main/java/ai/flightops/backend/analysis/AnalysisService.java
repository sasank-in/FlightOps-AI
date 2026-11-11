package ai.flightops.backend.analysis;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import ai.flightops.backend.audit.AuditEvent.Outcome;
import ai.flightops.backend.audit.AuditService;
import ai.flightops.backend.common.ApiException;
import ai.flightops.backend.flight.Flight;
import ai.flightops.backend.flight.FlightRepository;
import ai.flightops.backend.flight.FlightService;
import ai.flightops.backend.user.CurrentUser;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
public class AnalysisService {

    private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);

    public record AnalysisResponse(long id, long flightId, String status, String modelName, String modelVersion,
                                   Double threshold, Instant startedAt, Instant completedAt, JsonNode metrics,
                                   String error) {}

    public record EventResponse(int windowIndex, int windowStartSeconds, int windowEndSeconds, double anomalyScore,
                                double threshold, boolean isAnomaly, String severityLabel, JsonNode evidence) {}

    public record AnomaliesResponse(long flightId, long analysisId, String modelName, String modelVersion,
                                    Double threshold, int nWindows, long nAboveThreshold, List<EventResponse> events) {}

    private final AnalysisRunRepository runs;
    private final AnomalyEventRepository events;
    private final FlightService flights;
    private final FlightRepository flightRepo;
    private final AnalysisWorker worker;
    private final AnalysisStartLimiter limiter;
    private final AuditService audit;
    private final JsonMapper json;

    public AnalysisService(AnalysisRunRepository runs, AnomalyEventRepository events, FlightService flights,
                           FlightRepository flightRepo, AnalysisWorker worker, AnalysisStartLimiter limiter,
                           AuditService audit, JsonMapper json) {
        this.runs = runs;
        this.events = events;
        this.flights = flights;
        this.flightRepo = flightRepo;
        this.worker = worker;
        this.limiter = limiter;
        this.audit = audit;
        this.json = json;
    }

    /** Creates a PENDING run and hands it to the worker once the transaction has committed. */
    @Transactional
    public AnalysisResponse start(long flightId, CurrentUser user) {
        Flight flight = flights.getAuthorized(flightId, user);
        if (!limiter.tryAcquire(user.id())) {
            audit.record(user.username(), "ANALYSIS_START", "flight", flightId, Outcome.DENIED, "rate limited");
            throw ApiException.tooManyRequests("Too many analyses started; try again in a minute");
        }
        AnalysisRun run = runs.save(new AnalysisRun(flight.getId(), user.id()));
        long runId = run.getId();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    worker.execute(runId);
                } catch (TaskRejectedException e) {
                    log.warn("Analysis queue full; run {} rejected", runId);
                    worker.fail(runId, "Analysis queue is full; start the analysis again later");
                }
            }
        });
        audit.record(user.username(), "ANALYSIS_START", "analysis", runId, Outcome.SUCCESS, "flight=" + flightId);
        return toResponse(run);
    }

    @Transactional(readOnly = true)
    public AnalysisResponse get(long analysisId, CurrentUser user) {
        AnalysisRun run = runs.findById(analysisId).orElseThrow(() -> ApiException.notFound("Analysis"));
        authorize(run, user);
        return toResponse(run);
    }

    @Transactional(readOnly = true)
    public List<AnalysisResponse> listForFlight(long flightId, CurrentUser user) {
        flights.getAuthorized(flightId, user);
        return runs.findByFlightIdOrderByIdDesc(flightId).stream().map(this::toResponse).toList();
    }

    /** Events of the given run, or of the flight's latest COMPLETED run when analysisId is null. */
    @Transactional(readOnly = true)
    public AnomaliesResponse anomalies(long flightId, Long analysisId, boolean onlyAboveThreshold, CurrentUser user) {
        flights.getAuthorized(flightId, user);
        AnalysisRun run = analysisId == null
                ? runs.findFirstByFlightIdAndStatusOrderByIdDesc(flightId, AnalysisRun.Status.COMPLETED)
                        .orElseThrow(() -> ApiException.notFound("Completed analysis"))
                : runs.findById(analysisId).filter(r -> r.getFlightId() == flightId)
                        .orElseThrow(() -> ApiException.notFound("Analysis"));
        if (run.getStatus() != AnalysisRun.Status.COMPLETED) {
            throw ApiException.conflict("Analysis is " + run.getStatus() + "; events are available once it is COMPLETED");
        }
        List<AnomalyEvent> all = events.findByAnalysisRunIdOrderByWindowIndex(run.getId());
        List<EventResponse> out = all.stream()
                .filter(e -> !onlyAboveThreshold || e.isAnomaly())
                .map(e -> new EventResponse(e.getWindowIndex(), e.getStartOffset(), e.getEndOffset(), e.getScore(),
                        e.getThreshold(), e.isAnomaly(), e.getSeverityLabel(), json.readTree(e.getEvidenceJson())))
                .toList();
        long above = all.stream().filter(AnomalyEvent::isAnomaly).count();
        return new AnomaliesResponse(flightId, run.getId(), run.getModelName(), run.getModelVersion(),
                run.getThreshold(), all.size(), above, out);
    }

    private void authorize(AnalysisRun run, CurrentUser user) {
        Flight f = flightRepo.findById(run.getFlightId()).orElseThrow(() -> ApiException.notFound("Analysis"));
        if (!user.canAccess(f.getOwnerId())) {
            audit.record(user.username(), "ANALYSIS_ACCESS", "analysis", run.getId(), Outcome.DENIED, "not owner");
            throw ApiException.notFound("Analysis");
        }
    }

    private AnalysisResponse toResponse(AnalysisRun r) {
        JsonNode metrics = r.getMetricsJson() == null ? json.valueToTree(Map.of()) : json.readTree(r.getMetricsJson());
        return new AnalysisResponse(r.getId(), r.getFlightId(), r.getStatus().name(), r.getModelName(),
                r.getModelVersion(), r.getThreshold(), r.getStartedAt(), r.getCompletedAt(), metrics, r.getErrorMessage());
    }
}
