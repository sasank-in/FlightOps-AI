package ai.flightops.backend.analysis;

import java.util.EnumSet;

import ai.flightops.backend.report.Report;
import ai.flightops.backend.report.ReportRepository;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Analysis runs and reports left PENDING/RUNNING by a previous shutdown or crash can never finish:
 * mark them FAILED at startup.
 */
@Component
public class InterruptedRunRecovery implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(InterruptedRunRecovery.class);
    private final AnalysisRunRepository runs;
    private final ReportRepository reports;

    public InterruptedRunRecovery(AnalysisRunRepository runs, ReportRepository reports) {
        this.runs = runs;
        this.reports = reports;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        var stale = runs.findByStatusIn(EnumSet.of(AnalysisRun.Status.PENDING, AnalysisRun.Status.RUNNING));
        stale.forEach(r -> r.fail("Interrupted by a backend restart; start the analysis again"));
        if (!stale.isEmpty()) {
            log.warn("Marked {} interrupted analysis run(s) as FAILED", stale.size());
        }
        var staleReports = reports.findByStatusIn(EnumSet.of(Report.Status.PENDING, Report.Status.RUNNING));
        staleReports.forEach(r -> r.fail("Interrupted by a backend restart; request the report again"));
        if (!staleReports.isEmpty()) {
            log.warn("Marked {} interrupted report(s) as FAILED", staleReports.size());
        }
    }
}
