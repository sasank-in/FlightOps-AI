package ai.flightops.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

class ReportIT extends IntegrationTestBase {

    @Test
    void reportIsGroundedValidatedAndDownloadable() throws InterruptedException {
        String alice = createUser(adminToken(), "alice", "ANALYST");
        long[] ids = analysedFlight(alice, "REP-1", 150, 250, 180);   // stub: only window 1 (0.25) is above 0.2

        Resp created = send("POST", "/api/v1/reports", alice, Map.of("analysisId", ids[1]));
        assertThat(created.status()).isEqualTo(202);
        long id = created.body().get("id").asLong();
        assertThat(created.raw().headers().firstValue("Location")).hasValue("/api/v1/reports/" + id);

        JsonNode r = awaitReport(alice, id);
        assertThat(r.get("status").asString()).isEqualTo("COMPLETED");
        assertThat(r.get("generator").asString()).isEqualTo("llm");
        assertThat(r.get("llmModel").asString()).isEqualTo("stub-llm-1");
        assertThat(r.get("promptVersion").asString()).isEqualTo("r1");
        assertThat(r.get("flightId").asLong()).isEqualTo(ids[0]);

        // Evidence: verified results only, highest-scoring window first, refs to cite
        JsonNode ev = r.get("evidence");
        assertThat(ev.get("analysis").get("n_windows_above_threshold").asInt()).isEqualTo(1);
        assertThat(ev.get("windows").get(0).get("ref").asString()).isEqualTo("W1");
        assertThat(ev.get("windows").size()).isEqualTo(3);
        assertThat(ev.get("intervals").get(0).get("start_seconds").asInt()).isEqualTo(160);
        assertThat(ev.get("variables").get(0).get("feature").asString()).isEqualTo("airspeed");
        assertThat(ev.get("evaluation").get("test_pr_auc").asDouble()).isEqualTo(0.41);
        assertThat(ev.toString()).doesNotContain("\"telemetry\"");

        // The two grounded findings survive; invented number, maintenance advice and unknown ref are removed
        JsonNode content = r.get("content");
        assertThat(content.get("summary").asString()).isEqualTo("1 of 3 windows were above the threshold of 0.2.");
        assertThat(content.get("summaryReplaced").asBoolean()).isFalse();
        List<String> kept = new ArrayList<>();
        content.get("findings").forEach(f -> kept.add(f.get("statement").asString()));
        assertThat(kept).containsExactly("Window 1 has the highest score, 0.25.", "Window 1 runs from second 160 to 319.");
        assertThat(content.get("findings").get(1).get("basis").asString()).isEqualTo("measured");
        List<String> reasons = new ArrayList<>();
        content.get("removed").forEach(x -> reasons.add(x.get("reason").asString()));
        assertThat(reasons).hasSize(3);
        assertThat(reasons.get(0)).contains("999.5");
        assertThat(reasons.get(1)).contains("makes a claim outside the evidence");
        assertThat(reasons.get(2)).isEqualTo("cites evidence that does not exist");

        // The model got the key and the system prompt; the evidence went as data, not raw telemetry
        assertThat(StubLlmServer.lastAuthorization.get()).isEqualTo("Bearer test-llm-key");
        JsonNode req = StubLlmServer.lastRequest.get();
        assertThat(req.get("response_format").get("type").asString()).isEqualTo("json_object");
        assertThat(req.get("messages").get(0).get("content").asString()).contains("Never state or speculate about causes");

        Resp md = send("GET", "/api/v1/reports/" + id + "/markdown", alice, null);
        assertThat(md.status()).isEqualTo(200);
        assertThat(md.raw().headers().firstValue("Content-Type").orElse("")).startsWith("text/markdown");
        assertThat(md.raw().headers().firstValue("Content-Disposition").orElse(""))
                .contains("attachment").contains("flightops-report-" + id + "-REP-1.md");
        assertThat(md.raw().body())
                .contains("# Engineering report: flight REP-1")
                .contains("Not a confirmed fault or a safety determination")
                .contains("- **Measured:** Window 1 runs from second 160 to 319. _(evidence: W1)_")
                .contains("| W1 | 1 | 160–319 | 0.25 | 0.2 | Above threshold | airspeed |")
                .contains("3 removed")
                .doesNotContain("999.5").doesNotContain("inspected");

        JsonNode list = send("GET", "/api/v1/flights/" + ids[0] + "/reports", alice, null).body();
        assertThat(list.size()).isEqualTo(1);
        assertThat(list.get(0).get("id").asLong()).isEqualTo(id);
        assertThat(list.get(0).has("content")).isFalse();
        assertThat(jdbc.queryForObject("select count(*) from audit_events where action='REPORT_CREATE' and outcome='SUCCESS'",
                Long.class)).isEqualTo(1);
    }

    @Test
    void fallsBackToTheDeterministicTemplateWhenTheModelFailsOrIsUnusable() throws InterruptedException {
        String token = adminToken();
        long[] ids = analysedFlight(token, "REP-2", 150, 250, 260, 150);

        StubLlmServer.mode = StubLlmServer.Mode.HTTP_500;
        JsonNode failed = awaitReport(token, send("POST", "/api/v1/reports", token, Map.of("analysisId", ids[1])).body().get("id").asLong());
        assertThat(failed.get("status").asString()).isEqualTo("COMPLETED");
        assertThat(failed.get("generator").asString()).isEqualTo("deterministic");
        assertThat(failed.get("fallbackReason").asString()).isEqualTo("Language model request failed (HTTP 500)");
        JsonNode findings = failed.get("content").get("findings");
        assertThat(findings.get(0).get("statement").asString())
                .isEqualTo("2 of 4 windows (50%) scored at or above the model threshold of 0.2.");
        assertThat(findings.get(2).get("statement").asString())
                .isEqualTo("Above-threshold windows form 1 interval(s); the longest covers seconds 160 to 479 (2 window(s)).");

        StubLlmServer.mode = StubLlmServer.Mode.ALL_INVALID;
        JsonNode invalid = awaitReport(token, send("POST", "/api/v1/reports", token, Map.of("analysisId", ids[1])).body().get("id").asLong());
        assertThat(invalid.get("generator").asString()).isEqualTo("deterministic");
        assertThat(invalid.get("fallbackReason").asString()).isEqualTo("Language model output failed validation");

        StubLlmServer.mode = StubLlmServer.Mode.NOT_JSON;
        JsonNode prose = awaitReport(token, send("POST", "/api/v1/reports", token, Map.of("analysisId", ids[1])).body().get("id").asLong());
        assertThat(prose.get("generator").asString()).isEqualTo("deterministic");
        String md = send("GET", "/api/v1/reports/" + prose.get("id").asLong() + "/markdown", token, null).raw().body();
        assertThat(md).contains("deterministic template (no language model): Language model output failed validation");
    }

    @Test
    void retriesOnceWhenTheProviderIsRateLimited() throws InterruptedException {
        String token = adminToken();
        long[] ids = analysedFlight(token, "REP-5", 250);
        StubLlmServer.mode = StubLlmServer.Mode.RATE_LIMITED_ONCE;
        JsonNode r = awaitReport(token, send("POST", "/api/v1/reports", token, Map.of("analysisId", ids[1])).body().get("id").asLong());
        assertThat(r.get("generator").asString()).isEqualTo("llm");
        assertThat(r.get("fallbackReason").isNull()).isTrue();
    }

    @Test
    void reportsFollowFlightAccessAndNeedACompletedAnalysis() throws InterruptedException {
        String admin = adminToken();
        String alice = createUser(admin, "alice", "ANALYST");
        String bob = createUser(admin, "bob", "ANALYST");
        long[] ids = analysedFlight(alice, "REP-3", 250);
        long id = send("POST", "/api/v1/reports", alice, Map.of("analysisId", ids[1])).body().get("id").asLong();
        awaitReport(alice, id);

        assertThat(send("GET", "/api/v1/reports/" + id, bob, null).status()).isEqualTo(404);
        assertThat(send("GET", "/api/v1/reports/" + id + "/markdown", bob, null).status()).isEqualTo(404);
        assertThat(send("POST", "/api/v1/reports", bob, Map.of("analysisId", ids[1])).status()).isEqualTo(404);
        assertThat(send("GET", "/api/v1/flights/" + ids[0] + "/reports", bob, null).status()).isEqualTo(404);
        assertThat(send("GET", "/api/v1/reports/" + id, admin, null).status()).isEqualTo(200);
        assertThat(jdbc.queryForObject("select count(*) from audit_events where action='REPORT_ACCESS' and outcome='DENIED'",
                Long.class)).isGreaterThanOrEqualTo(3);

        assertThat(send("POST", "/api/v1/reports", alice, Map.of()).status()).isEqualTo(400);
        assertThat(send("POST", "/api/v1/reports", alice, Map.of("analysisId", 999_999)).status()).isEqualTo(404);
        assertThat(send("GET", "/api/v1/reports/999999", alice, null).status()).isEqualTo(404);

        StubInferenceServer.mode = StubInferenceServer.Mode.HTTP_500;
        long badFlight = upload(alice, "REP-4", 150);
        long failedRun = send("POST", "/api/v1/flights/" + badFlight + "/analyses", alice, null).body().get("id").asLong();
        awaitAnalysis(alice, failedRun);
        Resp conflict = send("POST", "/api/v1/reports", alice, Map.of("analysisId", failedRun));
        assertThat(conflict.status()).isEqualTo(409);
        assertThat(conflict.body().get("detail").asString()).contains("needs a COMPLETED analysis");

        assertThat(send("DELETE", "/api/v1/flights/" + ids[0], alice, null).status()).isEqualTo(204);
        assertThat(jdbc.queryForObject("select count(*) from reports", Long.class)).isZero();
    }
}
