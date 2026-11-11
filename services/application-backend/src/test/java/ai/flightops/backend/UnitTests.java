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
                null, null, null, null);
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
