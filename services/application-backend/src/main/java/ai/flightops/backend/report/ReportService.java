package ai.flightops.backend.report;

import java.time.Instant;
import java.util.List;

import ai.flightops.backend.analysis.AnalysisRun;
import ai.flightops.backend.analysis.AnalysisRunRepository;
import ai.flightops.backend.audit.AuditEvent.Outcome;
import ai.flightops.backend.audit.AuditService;
import ai.flightops.backend.common.ApiException;
import ai.flightops.backend.common.PerUserMinuteLimiter;
import ai.flightops.backend.config.AppProperties;
import ai.flightops.backend.flight.Flight;
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
public class ReportService {

    private static final Logger log = LoggerFactory.getLogger(ReportService.class);

    public record ReportSummary(long id, long flightId, long analysisId, String status, String generator,
                                String llmModel, Instant createdAt, Instant completedAt, String error) {}

    public record ReportResponse(long id, long flightId, long analysisId, String status, String generator,
                                 String llmProvider, String llmModel, String promptVersion, String fallbackReason,
                                 Instant createdAt, Instant completedAt, String error, JsonNode content,
                                 JsonNode evidence) {}

    public record Markdown(String filename, String body) {}

    private final ReportRepository reports;
    private final AnalysisRunRepository runs;
    private final FlightService flights;
    private final ReportWorker worker;
    private final AuditService audit;
    private final JsonMapper json;
    private final PerUserMinuteLimiter limiter;

    public ReportService(ReportRepository reports, AnalysisRunRepository runs, FlightService flights,
                         ReportWorker worker, AuditService audit, JsonMapper json, AppProperties props) {
        this.reports = reports;
        this.runs = runs;
        this.flights = flights;
        this.worker = worker;
        this.audit = audit;
        this.json = json;
        this.limiter = new PerUserMinuteLimiter(props.reports().maxPerMinute());
    }

    /** Creates a PENDING report for a COMPLETED analysis and starts it after the transaction commits. */
    @Transactional
    public ReportResponse create(long analysisId, CurrentUser user) {
        AnalysisRun run = runs.findById(analysisId).orElseThrow(() -> ApiException.notFound("Analysis"));
        Flight flight = authorizedFlight(run.getFlightId(), user, "analysis", analysisId);
        if (run.getStatus() != AnalysisRun.Status.COMPLETED) {
            throw ApiException.conflict("Analysis is " + run.getStatus() + "; a report needs a COMPLETED analysis");
        }
        if (!limiter.tryAcquire(user.id())) {
            audit.record(user.username(), "REPORT_CREATE", "analysis", analysisId, Outcome.DENIED, "rate limited");
            throw ApiException.tooManyRequests("Too many reports requested; try again in a minute");
        }
        Report report = reports.save(new Report(run.getId(), flight.getId(), user.id()));
        long id = report.getId();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                try {
                    worker.execute(id);
                } catch (TaskRejectedException e) {
                    log.warn("Report queue full; report {} rejected", id);
                    worker.fail(id, "Report queue is full; request the report again later");
                }
            }
        });
        audit.record(user.username(), "REPORT_CREATE", "report", id, Outcome.SUCCESS, "analysis=" + analysisId);
        return toResponse(report);
    }

    @Transactional(readOnly = true)
    public ReportResponse get(long id, CurrentUser user) {
        Report r = reports.findById(id).orElseThrow(() -> ApiException.notFound("Report"));
        authorizedFlight(r.getFlightId(), user, "report", id);
        return toResponse(r);
    }

    @Transactional(readOnly = true)
    public List<ReportSummary> listForFlight(long flightId, CurrentUser user) {
        flights.getAuthorized(flightId, user);
        return reports.findByFlightIdOrderByIdDesc(flightId).stream()
                .map(r -> new ReportSummary(r.getId(), r.getFlightId(), r.getAnalysisRunId(), r.getStatus().name(),
                        r.getGenerator(), r.getLlmModel(), r.getCreatedAt(), r.getCompletedAt(), r.getErrorMessage()))
                .toList();
    }

    @Transactional(readOnly = true)
    public Markdown markdown(long id, CurrentUser user) {
        Report r = reports.findById(id).orElseThrow(() -> ApiException.notFound("Report"));
        Flight f = authorizedFlight(r.getFlightId(), user, "report", id);
        if (r.getStatus() != Report.Status.COMPLETED || r.getContentMd() == null) {
            throw ApiException.conflict("Report is " + r.getStatus() + "; the document is available once it is COMPLETED");
        }
        String safeRef = f.getExternalFlightReference().replaceAll("[^A-Za-z0-9._-]", "_");
        return new Markdown("flightops-report-" + r.getId() + "-" + safeRef + ".md", r.getContentMd());
    }

    /** Same rule as flights: someone else's report is reported as not found, and the attempt is audited. */
    private Flight authorizedFlight(long flightId, CurrentUser user, String entity, long entityId) {
        try {
            return flights.getAuthorized(flightId, user);
        } catch (ApiException e) {
            audit.record(user.username(), "REPORT_ACCESS", entity, entityId, Outcome.DENIED, "not owner");
            throw ApiException.notFound(entity.equals("report") ? "Report" : "Analysis");
        }
    }

    private ReportResponse toResponse(Report r) {
        return new ReportResponse(r.getId(), r.getFlightId(), r.getAnalysisRunId(), r.getStatus().name(), r.getGenerator(),
                r.getLlmProvider(), r.getLlmModel(), r.getPromptVersion(), r.getFallbackReason(), r.getCreatedAt(),
                r.getCompletedAt(), r.getErrorMessage(),
                r.getContentJson() == null ? null : json.readTree(r.getContentJson()),
                r.getEvidenceJson() == null ? null : json.readTree(r.getEvidenceJson()));
    }
}
