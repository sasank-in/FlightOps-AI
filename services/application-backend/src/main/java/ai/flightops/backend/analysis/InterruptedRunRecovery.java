package ai.flightops.backend.analysis;

import java.util.EnumSet;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Runs left PENDING/RUNNING by a previous shutdown or crash can never finish: mark them FAILED at startup. */
@Component
public class InterruptedRunRecovery implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(InterruptedRunRecovery.class);
    private final AnalysisRunRepository runs;

    public InterruptedRunRecovery(AnalysisRunRepository runs) {
        this.runs = runs;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        var stale = runs.findByStatusIn(EnumSet.of(AnalysisRun.Status.PENDING, AnalysisRun.Status.RUNNING));
        stale.forEach(r -> r.fail("Interrupted by a backend restart; start the analysis again"));
        if (!stale.isEmpty()) {
            log.warn("Marked {} interrupted analysis run(s) as FAILED", stale.size());
        }
    }
}
