package ai.flightops.backend.analysis;

import java.time.Clock;
import java.util.concurrent.ConcurrentHashMap;

import ai.flightops.backend.config.AppProperties;

import org.springframework.stereotype.Component;

/** Per-user fixed one-minute window rate limit for starting analyses (in-memory, per instance). */
@Component
public class AnalysisStartLimiter {

    private record Window(long minute, int count) {}

    private final ConcurrentHashMap<Long, Window> windows = new ConcurrentHashMap<>();
    private final int maxPerMinute;
    private final Clock clock;

    public AnalysisStartLimiter(AppProperties props) {
        this.maxPerMinute = props.analysis().maxStartsPerMinute();
        this.clock = Clock.systemUTC();
    }

    /** Returns true and counts the start if the user is under the limit. */
    public boolean tryAcquire(long userId) {
        long minute = clock.millis() / 60_000L;
        Window w = windows.compute(userId, (k, cur) ->
                (cur == null || cur.minute() != minute) ? new Window(minute, 1) : new Window(minute, cur.count() + 1));
        return w.count() <= maxPerMinute;
    }
}
