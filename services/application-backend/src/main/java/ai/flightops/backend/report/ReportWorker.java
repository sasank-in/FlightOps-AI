package ai.flightops.backend.report;

import java.util.List;

import ai.flightops.backend.analysis.AnalysisRun;
import ai.flightops.backend.analysis.AnalysisRunRepository;
import ai.flightops.backend.analysis.AnomalyEvent;
import ai.flightops.backend.analysis.AnomalyEventRepository;
import ai.flightops.backend.analysis.InferenceClient;
import ai.flightops.backend.config.AsyncConfig;
import ai.flightops.backend.flight.Flight;
import ai.flightops.backend.flight.FlightRepository;
import ai.flightops.backend.report.ReportComposer.Content;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Generates a report in the background: evidence package, then the language-model narrative (validated)
 * or, when the model is disabled, fails or produces nothing usable, the deterministic template.
 */
@Component
public class ReportWorker {

    private static final Logger log = LoggerFactory.getLogger(ReportWorker.class);

    private final ReportRepository reports;
    private final AnalysisRunRepository runs;
    private final AnomalyEventRepository events;
    private final FlightRepository flights;
    private final InferenceClient inference;
    private final EvidenceBuilder evidenceBuilder;
    private final ReportComposer composer;
    private final LlmClient llm;
    private final JsonMapper json;
    private final TransactionTemplate tx;

    public ReportWorker(ReportRepository reports, AnalysisRunRepository runs, AnomalyEventRepository events,
                        FlightRepository flights, InferenceClient inference, EvidenceBuilder evidenceBuilder,
                        ReportComposer composer, LlmClient llm, JsonMapper json, TransactionTemplate tx) {
        this.reports = reports;
        this.runs = runs;
        this.events = events;
        this.flights = flights;
        this.inference = inference;
        this.evidenceBuilder = evidenceBuilder;
        this.composer = composer;
        this.llm = llm;
        this.json = json;
        this.tx = tx;
    }

    @Async(AsyncConfig.REPORT_EXECUTOR)
    public void execute(long reportId) {
        try {
            generate(reportId);
        } catch (RuntimeException e) {
            log.error("Report {} failed", reportId, e);
            fail(reportId, "Report generation failed due to an internal error");
        }
    }

    void generate(long reportId) {
        record Inputs(Report report, AnalysisRun run, Flight flight, List<AnomalyEvent> events) {}
        Inputs in = tx.execute(s -> {
            Report r = reports.findById(reportId).orElseThrow();
            r.markRunning();
            AnalysisRun run = runs.findById(r.getAnalysisRunId()).orElseThrow();
            Flight f = flights.findById(r.getFlightId()).orElseThrow();
            return new Inputs(r, run, f, events.findByAnalysisRunIdOrderByWindowIndex(run.getId()));
        });

        JsonNode modelCard = null;
        try {
            modelCard = inference.modelInfo();
        } catch (RuntimeException e) {
            log.warn("Model card unavailable for report {}: {}", reportId, e.getClass().getSimpleName());
        }
        EvidenceBuilder.Evidence evidence = evidenceBuilder.build(in.flight(), in.run(), in.events(), modelCard);

        String generator = "deterministic";
        String provider = null;
        String model = null;
        String fallback = null;
        Content content = null;
        if (llm.enabled()) {
            try {
                LlmClient.Completion c = llm.complete(ReportComposer.SYSTEM_PROMPT, json.writeValueAsString(evidence.root()));
                content = composer.fromModel(c.content(), evidence);
                if (content == null) {
                    fallback = "Language model output failed validation";
                } else {
                    generator = "llm";
                    provider = llm.provider();
                    model = c.model();
                }
            } catch (LlmClient.LlmException e) {
                log.warn("Report {}: {}", reportId, e.getMessage());
                fallback = e.getMessage();
            }
        } else {
            fallback = "Language model not configured";
        }
        if (content == null) {
            content = composer.deterministic(evidence);
        }

        String createdAt = in.report().getCreatedAt().toString();
        String md = composer.markdown(new ReportComposer.Meta(reportId, generator, provider, model, createdAt, fallback),
                content, evidence.root());
        String evidenceJson = json.writeValueAsString(evidence.root());
        String contentJson = json.writeValueAsString(content);
        String g = generator, p = provider, m = model, fb = fallback;
        tx.executeWithoutResult(s -> reports.findById(reportId).ifPresent(r ->
                r.complete(g, p, m, ReportComposer.PROMPT_VERSION, evidenceJson, contentJson, md, fb)));
    }

    void fail(long reportId, String message) {
        try {
            tx.executeWithoutResult(s -> reports.findById(reportId).ifPresent(r -> r.fail(message)));
        } catch (RuntimeException e) {
            log.error("Could not mark report {} as failed", reportId, e);
        }
    }
}
