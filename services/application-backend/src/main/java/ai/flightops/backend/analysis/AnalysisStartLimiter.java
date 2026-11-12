package ai.flightops.backend.analysis;

import ai.flightops.backend.common.PerUserMinuteLimiter;
import ai.flightops.backend.config.AppProperties;

import org.springframework.stereotype.Component;

/** Per-user rate limit for starting analyses. */
@Component
public class AnalysisStartLimiter extends PerUserMinuteLimiter {

    public AnalysisStartLimiter(AppProperties props) {
        super(props.analysis().maxStartsPerMinute());
    }
}
