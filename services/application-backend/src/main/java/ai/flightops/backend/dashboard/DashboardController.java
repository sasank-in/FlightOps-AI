package ai.flightops.backend.dashboard;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;

import ai.flightops.backend.analysis.InferenceClient;
import ai.flightops.backend.common.ApiException;
import ai.flightops.backend.user.CurrentUser;
import ai.flightops.backend.user.UserContext;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import tools.jackson.databind.JsonNode;

/** Read-only endpoints for the dashboard: current user, model card, and user-scoped summary statistics. */
@RestController
@RequestMapping("/api/v1")
public class DashboardController {

    private static final Logger log = LoggerFactory.getLogger(DashboardController.class);

    public record MeResponse(long id, String username, String role) {}

    public record RecentAnalysis(long analysisId, long flightId, String externalFlightReference, String status,
                                 Instant startedAt, Instant completedAt, Integer nWindows, Integer nAboveThreshold) {}

    public record FlightAlertSummary(long flightId, String externalFlightReference, long analysisId,
                                     int nWindows, int nAboveThreshold) {}

    public record StatsResponse(long flights, long windows, long analysesCompleted, long analysesFailed,
                                long analysesInProgress, long windowsScored, long windowsAboveThreshold,
                                Instant lastAnalysisAt, List<RecentAnalysis> recentAnalyses,
                                List<FlightAlertSummary> flightsByAlerts) {}

    /** Visible flights: all for admins, own otherwise. */
    private static final String VISIBLE = "(:admin or f.owner_id = :uid)";

    private final UserContext userContext;
    private final NamedParameterJdbcTemplate jdbc;
    private final InferenceClient inference;

    public DashboardController(UserContext userContext, NamedParameterJdbcTemplate jdbc, InferenceClient inference) {
        this.userContext = userContext;
        this.jdbc = jdbc;
        this.inference = inference;
    }

    @GetMapping("/me")
    public MeResponse me(@AuthenticationPrincipal Jwt jwt) {
        CurrentUser u = userContext.resolve(jwt);
        return new MeResponse(u.id(), u.username(), u.role().name());
    }

    @GetMapping("/model")
    public JsonNode model(@AuthenticationPrincipal Jwt jwt) {
        userContext.resolve(jwt);
        try {
            return inference.modelInfo();
        } catch (RuntimeException e) {
            log.warn("Model info unavailable: {}", e.getClass().getSimpleName());
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Inference service unavailable");
        }
    }

    @GetMapping("/stats")
    @Transactional(readOnly = true)
    public StatsResponse stats(@AuthenticationPrincipal Jwt jwt) {
        CurrentUser u = userContext.resolve(jwt);
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("admin", u.isAdmin()).addValue("uid", u.id());

        long flights = count("select count(*) from flights f where " + VISIBLE, p);
        long windows = count("select coalesce(sum(f.n_windows), 0) from flights f where " + VISIBLE, p);
        String runs = "from analysis_runs r join flights f on f.id = r.flight_id where " + VISIBLE;
        long completed = count("select count(*) " + runs + " and r.status = 'COMPLETED'", p);
        long failed = count("select count(*) " + runs + " and r.status = 'FAILED'", p);
        long inProgress = count("select count(*) " + runs + " and r.status in ('PENDING', 'RUNNING')", p);
        Timestamp last = jdbc.queryForObject("select max(r.started_at) " + runs, p, Timestamp.class);

        // Each flight's most recent COMPLETED run: the current picture, not the sum of re-runs.
        String latest = "with latest as (select distinct on (r.flight_id) r.id, r.flight_id " + runs
                + " and r.status = 'COMPLETED' order by r.flight_id, r.id desc) ";
        List<FlightAlertSummary> byFlight = jdbc.query(latest
                + "select l.flight_id, f.external_flight_reference, l.id as run_id, count(e.id) as n, "
                + "count(e.id) filter (where e.is_anomaly) as above "
                + "from latest l join flights f on f.id = l.flight_id join anomaly_events e on e.analysis_run_id = l.id "
                + "group by l.flight_id, f.external_flight_reference, l.id order by above desc, l.flight_id desc",
                p, (rs, i) -> new FlightAlertSummary(rs.getLong("flight_id"), rs.getString("external_flight_reference"),
                        rs.getLong("run_id"), rs.getInt("n"), rs.getInt("above")));
        long scored = byFlight.stream().mapToLong(FlightAlertSummary::nWindows).sum();
        long above = byFlight.stream().mapToLong(FlightAlertSummary::nAboveThreshold).sum();

        List<RecentAnalysis> recent = jdbc.query(
                "select r.id, r.flight_id, f.external_flight_reference, r.status, r.started_at, r.completed_at, "
                        + "(r.metrics_json ->> 'n_windows')::int as n, (r.metrics_json ->> 'n_above_threshold')::int as above "
                        + runs + " order by r.id desc limit 8",
                p, (rs, i) -> new RecentAnalysis(rs.getLong("id"), rs.getLong("flight_id"),
                        rs.getString("external_flight_reference"), rs.getString("status"),
                        toInstant(rs.getTimestamp("started_at")), toInstant(rs.getTimestamp("completed_at")),
                        (Integer) rs.getObject("n"), (Integer) rs.getObject("above")));

        return new StatsResponse(flights, windows, completed, failed, inProgress, scored, above, toInstant(last),
                recent, byFlight.stream().limit(10).toList());
    }

    private long count(String sql, MapSqlParameterSource p) {
        Long v = jdbc.queryForObject(sql, p, Long.class);
        return v == null ? 0 : v;
    }

    private static Instant toInstant(Timestamp t) {
        return t == null ? null : t.toInstant();
    }
}
