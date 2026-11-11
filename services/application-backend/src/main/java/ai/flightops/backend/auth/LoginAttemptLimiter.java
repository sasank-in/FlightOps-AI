package ai.flightops.backend.auth;

import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.concurrent.ConcurrentHashMap;

import ai.flightops.backend.config.AppProperties;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Brute-force protection: after N consecutive failed logins for a username, further attempts are
 * refused for the lockout period. In-memory, so it applies per backend instance.
 */
@Component
public class LoginAttemptLimiter {

    private record State(int failures, Instant lockedUntil) {}

    private final ConcurrentHashMap<String, State> states = new ConcurrentHashMap<>();
    private final int maxFailures;
    private final java.time.Duration lockout;
    private final Clock clock;

    @Autowired
    public LoginAttemptLimiter(AppProperties props) {
        this(props, Clock.systemUTC());
    }

    LoginAttemptLimiter(AppProperties props, Clock clock) {
        this.maxFailures = props.security().maxFailedLogins();
        this.lockout = props.security().lockout();
        this.clock = clock;
    }

    private static String key(String username) {
        return username == null ? "" : username.trim().toLowerCase(Locale.ROOT);
    }

    public boolean isLocked(String username) {
        State s = states.get(key(username));
        return s != null && s.lockedUntil() != null && clock.instant().isBefore(s.lockedUntil());
    }

    public void recordFailure(String username) {
        states.compute(key(username), (k, s) -> {
            Instant now = clock.instant();
            int failures = (s == null || (s.lockedUntil() != null && !now.isBefore(s.lockedUntil()))) ? 1 : s.failures() + 1;
            return new State(failures, failures >= maxFailures ? now.plus(lockout) : null);
        });
    }

    public void recordSuccess(String username) {
        states.remove(key(username));
    }
}
