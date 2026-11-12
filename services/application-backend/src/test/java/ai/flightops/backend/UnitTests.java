package ai.flightops.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import ai.flightops.backend.config.DatabaseUrl;
import ai.flightops.backend.flight.TelemetrySchema;

import org.junit.jupiter.api.Test;

/** Plain unit tests (no Spring context, no database). */
class UnitTests {

    @Test
    void databaseUrlParsesAndNeverPrintsThePassword() {
        DatabaseUrl db = DatabaseUrl.parse("postgresql://postgres:s3cr%40t@localhost:5432/flightops", null); // secret-scan: allow (fake)
        assertThat(db.jdbcUrl()).isEqualTo("jdbc:postgresql://localhost:5432/flightops");
        assertThat(db.username()).isEqualTo("postgres");
        assertThat(db.password()).isEqualTo("s3cr@t");
        assertThat(db.toString()).doesNotContain("s3cr");

        assertThat(DatabaseUrl.parse("postgres://u:p@db.example:6543/x", "flightops_test").jdbcUrl()) // secret-scan: allow (fake)
                .isEqualTo("jdbc:postgresql://db.example:6543/flightops_test");
        assertThat(DatabaseUrl.parse("postgresql://u:p@host/db", null).jdbcUrl()).isEqualTo("jdbc:postgresql://host:5432/db"); // secret-scan: allow (fake)
    }

    @Test
    void databaseUrlErrorsAreClearAndHideTheSecret() {
        assertThatThrownBy(() -> DatabaseUrl.parse("", null)).hasMessageContaining("DATABASE_URL is not set");
        assertThatThrownBy(() -> DatabaseUrl.parse("mysql://u:p@h/db", null)).hasMessageContaining("postgresql://"); // secret-scan: allow (fake)
        assertThatThrownBy(() -> DatabaseUrl.parse("postgresql://user@h/db", null)).hasMessageContaining("user and password");
        assertThatThrownBy(() -> DatabaseUrl.parse("postgresql://u:topsecret@h/db;drop", null)) // secret-scan: allow (fake)
                .hasMessageNotContaining("topsecret");
    }

    @Test
    void telemetrySchemaMatchesThePythonSchema() throws Exception {
        Path schema = Path.of("..", "..", "src", "flightops", "data", "schema.py");
        String py = Files.readString(schema);
        int start = py.indexOf("FEATURES:");
        py = py.substring(start, py.indexOf("\n]", start));   // only the FEATURES list, not other tuples
        Matcher m = Pattern.compile("\\(\"[^\"]+\",\\s*\"([a-z_]+)\",\\s*\"[^\"]*\"\\)").matcher(py);
        List<String> pythonNames = new ArrayList<>();
        while (m.find()) {
            pythonNames.add(m.group(1));
        }
        assertThat(pythonNames).containsExactlyElementsOf(TelemetrySchema.VARIABLES);
        assertThat(TelemetrySchema.TIMESTEPS).isEqualTo(160);
    }

    @Test
    void loginLimiterLocksAndUnlocksOverTime() throws Exception {
        var props = new ai.flightops.backend.config.AppProperties(null,
                new ai.flightops.backend.config.AppProperties.Security("x".repeat(32), Duration.ofHours(1), 3, Duration.ofMinutes(15)),
                null, null, null, null, null, null);
        MutableClock clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        var ctor = ai.flightops.backend.auth.LoginAttemptLimiter.class.getDeclaredConstructor(
                ai.flightops.backend.config.AppProperties.class, Clock.class);
        ctor.setAccessible(true);
        var limiter = ctor.newInstance(props, clock);

        limiter.recordFailure("Eve");
        limiter.recordFailure("eve ");
        assertThat(limiter.isLocked("EVE")).isFalse();
        limiter.recordFailure("eve");
        assertThat(limiter.isLocked("eve")).isTrue();          // case/whitespace-insensitive key
        clock.now = clock.now.plus(Duration.ofMinutes(16));
        assertThat(limiter.isLocked("eve")).isFalse();
        limiter.recordFailure("eve");                            // counting restarts after lockout expires
        assertThat(limiter.isLocked("eve")).isFalse();
        limiter.recordSuccess("eve");
    }

    @Test
    void reportValidatorRejectsInventedNumbersAndOutOfScopeClaims() {
        java.util.Set<Double> ev = java.util.Set.of(0.9713, 0.25, 160.0, 319.0, 3.0, 12.5, 2.41);
        var check = (java.util.function.Function<String, String>) s ->
                ai.flightops.backend.report.ReportComposer.check(s, ev);
        assertThat(check.apply("Window 3 scored 0.25, above the threshold of 0.971.")).isNull();   // rounding allowed
        assertThat(check.apply("Seconds 160 to 319 in W3.")).isNull();                              // refs are not numbers
        assertThat(check.apply("12.5% of windows were above the threshold.")).isNull();
        assertThat(check.apply("The z-score was 2.4.")).isNull();
        assertThat(check.apply("The z-score was -2.41.")).isNull();
        assertThat(check.apply("Score 0.98 in window 3.")).contains("0.98");
        assertThat(check.apply("Window 2 was unusual.")).contains("number 2");     // small whole numbers must match exactly
        assertThat(check.apply("Airspeed was 13 kt high.")).isNull();              // 12.5 rounds to 13
        assertThat(check.apply("This may indicate a malfunction of the sensor.")).contains("malfunction");
        assertThat(check.apply("We recommend an inspection.")).contains("recommend");
        assertThat(check.apply("The pitot tube should be replaced.")).contains("should be replaced");
        assertThat(check.apply("Possibly caused by a gust.")).contains("caused by");
        assertThat(check.apply("It exceeded aircraft limits.")).contains("aircraft limits");
        assertThat(check.apply("Not a safety determination; engineering review is needed.")).isNull();
    }

    @Test
    void perUserLimiterResetsEachMinuteAndIsPerUser() {
        MutableClock clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        var limiter = new ai.flightops.backend.common.PerUserMinuteLimiter(2, clock);
        assertThat(limiter.tryAcquire(1)).isTrue();
        assertThat(limiter.tryAcquire(1)).isTrue();
        assertThat(limiter.tryAcquire(1)).isFalse();
        assertThat(limiter.tryAcquire(2)).isTrue();
        clock.now = clock.now.plusSeconds(60);
        assertThat(limiter.tryAcquire(1)).isTrue();
    }

    static final class MutableClock extends Clock {
        Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }
}
