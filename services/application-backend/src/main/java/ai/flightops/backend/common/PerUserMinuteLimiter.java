package ai.flightops.backend.common;

import java.time.Clock;
import java.util.concurrent.ConcurrentHashMap;

/** Per-user fixed one-minute window rate limit (in-memory, per instance). */
public class PerUserMinuteLimiter {

    private record Window(long minute, int count) {}

    private final ConcurrentHashMap<Long, Window> windows = new ConcurrentHashMap<>();
    private final int maxPerMinute;
    private final Clock clock;

    public PerUserMinuteLimiter(int maxPerMinute) {
        this(maxPerMinute, Clock.systemUTC());
    }

    public PerUserMinuteLimiter(int maxPerMinute, Clock clock) {
        this.maxPerMinute = maxPerMinute;
        this.clock = clock;
    }

    /** Returns true and counts the attempt if the user is under the limit. */
    public boolean tryAcquire(long userId) {
        long minute = clock.millis() / 60_000L;
        windows.entrySet().removeIf(e -> e.getValue().minute() < minute);    // keeps the map bounded
        Window w = windows.compute(userId, (k, cur) ->
                (cur == null || cur.minute() != minute) ? new Window(minute, 1) : new Window(minute, cur.count() + 1));
        return w.count() <= maxPerMinute;
    }
}
