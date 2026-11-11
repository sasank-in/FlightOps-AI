package ai.flightops.backend;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import ai.flightops.backend.analysis.InterruptedRunRecovery;

import tools.jackson.databind.JsonNode;

class AnalysisIT extends IntegrationTestBase {

    @Autowired
    InterruptedRunRecovery recovery;

    @Test
    void analysisScoresEveryWindowAndStoresEvents() throws InterruptedException {
        String token = createUser(adminToken(), "alice", "ANALYST");
        long flight = upload(token, "AN-1", 150, 250, 180);

        Resp started = send("POST", "/api/v1/flights/" + flight + "/analyses", token, null);
        assertThat(started.status()).isEqualTo(202);
        long run = started.body().get("id").asLong();
        assertThat(started.raw().headers().firstValue("Location")).hasValue("/api/v1/analyses/" + run);

        JsonNode done = awaitAnalysis(token, run);
        assertThat(done.get("status").asString()).isEqualTo("COMPLETED");
        assertThat(done.get("modelName").asString()).isEqualTo("stub_model");
        assertThat(done.get("modelVersion").asString()).isEqualTo("9.9.9");
        assertThat(done.get("metrics").get("n_windows").asInt()).isEqualTo(3);
        assertThat(done.get("metrics").get("n_above_threshold").asInt()).isEqualTo(1);

        JsonNode anomalies = send("GET", "/api/v1/flights/" + flight + "/anomalies", token, null).body();
        assertThat(anomalies.get("analysisId").asLong()).isEqualTo(run);
        assertThat(anomalies.get("events").size()).isEqualTo(3);
        JsonNode second = anomalies.get("events").get(1);
        assertThat(second.get("windowIndex").asInt()).isEqualTo(1);
        assertThat(second.get("windowStartSeconds").asInt()).isEqualTo(160);
        assertThat(second.get("isAnomaly").asBoolean()).isTrue();
        assertThat(second.get("severityLabel").asString()).isEqualTo("ABOVE_THRESHOLD");
        assertThat(second.get("evidence").get("supporting_features").get(0).get("feature").asString()).isEqualTo("airspeed");

        JsonNode onlyAbove = send("GET", "/api/v1/flights/" + flight + "/anomalies?onlyAboveThreshold=true", token, null).body();
        assertThat(onlyAbove.get("events").size()).isEqualTo(1);
        assertThat(onlyAbove.get("nWindows").asInt()).isEqualTo(3);

        assertThat(send("GET", "/api/v1/flights/" + flight + "/analyses", token, null).body().size()).isEqualTo(1);
    }

    @Test
    void inferenceErrorsMarkTheRunFailedWithASafeMessage() throws InterruptedException {
        String token = adminToken();
        long flight = upload(token, "AN-2", 150);

        StubInferenceServer.mode = StubInferenceServer.Mode.HTTP_500;
        JsonNode failed = awaitAnalysis(token, send("POST", "/api/v1/flights/" + flight + "/analyses", token, null).body().get("id").asLong());
        assertThat(failed.get("status").asString()).isEqualTo("FAILED");
        assertThat(failed.get("error").asString()).isEqualTo("Inference service rejected the request (HTTP 500)");

        StubInferenceServer.mode = StubInferenceServer.Mode.WRONG_COUNT;
        long flight2 = upload(token, "AN-3", 150, 160);
        JsonNode mismatch = awaitAnalysis(token, send("POST", "/api/v1/flights/" + flight2 + "/analyses", token, null).body().get("id").asLong());
        assertThat(mismatch.get("status").asString()).isEqualTo("FAILED");
        assertThat(mismatch.get("error").asString()).contains("does not match");
        assertThat(jdbc.queryForObject("select count(*) from anomaly_events", Long.class)).isZero();   // no partial results

        assertThat(send("GET", "/api/v1/flights/" + flight + "/anomalies", token, null).status()).isEqualTo(404);
    }

    @Test
    void anomaliesOfAnUnfinishedOrForeignRunAreNotReturned() {
        String token = adminToken();
        long flight = upload(token, "AN-4", 150);
        long otherFlight = upload(token, "AN-5", 150);
        jdbc.update("insert into analysis_runs (flight_id, requested_by, status) values (?, 1, 'RUNNING')", flight);
        long runId = jdbc.queryForObject("select max(id) from analysis_runs", Long.class);

        assertThat(send("GET", "/api/v1/flights/" + flight + "/anomalies?analysisId=" + runId, token, null).status()).isEqualTo(409);
        assertThat(send("GET", "/api/v1/flights/" + otherFlight + "/anomalies?analysisId=" + runId, token, null).status()).isEqualTo(404);
    }

    @Test
    void runsInterruptedByARestartAreMarkedFailed() throws Exception {
        String token = adminToken();
        long flight = upload(token, "AN-6", 150);
        jdbc.update("insert into analysis_runs (flight_id, requested_by, status) values (?, 1, 'PENDING')", flight);
        long runId = jdbc.queryForObject("select max(id) from analysis_runs", Long.class);

        recovery.run(null);

        JsonNode run = send("GET", "/api/v1/analyses/" + runId, token, null).body();
        assertThat(run.get("status").asString()).isEqualTo("FAILED");
        assertThat(run.get("error").asString()).contains("restart");
    }
}
