package ai.flightops.backend;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

class DashboardIT extends IntegrationTestBase {

    @Test
    void meReturnsTheCurrentUserAndRole() {
        String analyst = createUser(adminToken(), "alice", "ANALYST");
        JsonNode me = send("GET", "/api/v1/me", analyst, null).body();
        assertThat(me.get("username").asString()).isEqualTo("alice");
        assertThat(me.get("role").asString()).isEqualTo("ANALYST");
        assertThat(send("GET", "/api/v1/me", null, null).status()).isEqualTo(401);
    }

    @Test
    void modelCardIsProxiedAndFailsCleanly() {
        String token = adminToken();
        JsonNode model = send("GET", "/api/v1/model", token, null).body();
        assertThat(model.get("model_name").asString()).isEqualTo("stub_model");
        assertThat(model.get("evaluation").get("test_pr_auc").asDouble()).isEqualTo(0.41);

        StubInferenceServer.mode = StubInferenceServer.Mode.HTTP_500;
        Resp down = send("GET", "/api/v1/model", token, null);
        assertThat(down.status()).isEqualTo(503);
        assertThat(down.body().get("detail").asString()).isEqualTo("Inference service unavailable");
    }

    @Test
    void statsAreScopedToTheUserAndUseEachFlightsLatestRun() throws InterruptedException {
        String admin = adminToken();
        String alice = createUser(admin, "alice", "ANALYST");
        String bob = createUser(admin, "bob", "ANALYST");
        long f1 = upload(alice, "A-1", 150, 250, 260);     // two windows above the stub's 200 kt rule
        upload(alice, "A-2", 150);

        long run1 = send("POST", "/api/v1/flights/" + f1 + "/analyses", alice, null).body().get("id").asLong();
        awaitAnalysis(alice, run1);
        long run2 = send("POST", "/api/v1/flights/" + f1 + "/analyses", alice, null).body().get("id").asLong();
        awaitAnalysis(alice, run2);                      // re-run must not double-count

        JsonNode s = send("GET", "/api/v1/stats", alice, null).body();
        assertThat(s.get("flights").asLong()).isEqualTo(2);
        assertThat(s.get("windows").asLong()).isEqualTo(4);
        assertThat(s.get("analysesCompleted").asLong()).isEqualTo(2);
        assertThat(s.get("windowsScored").asLong()).isEqualTo(3);
        assertThat(s.get("windowsAboveThreshold").asLong()).isEqualTo(2);
        assertThat(s.get("flightsByAlerts").get(0).get("analysisId").asLong()).isEqualTo(run2);
        assertThat(s.get("recentAnalyses").get(0).get("analysisId").asLong()).isEqualTo(run2);
        assertThat(s.get("recentAnalyses").get(0).get("nAboveThreshold").asInt()).isEqualTo(2);
        assertThat(s.get("lastAnalysisAt").isNull()).isFalse();

        JsonNode empty = send("GET", "/api/v1/stats", bob, null).body();
        assertThat(empty.get("flights").asLong()).isZero();
        assertThat(empty.get("recentAnalyses").size()).isZero();
        assertThat(empty.get("lastAnalysisAt").isNull()).isTrue();

        assertThat(send("GET", "/api/v1/stats", admin, null).body().get("flights").asLong()).isEqualTo(2);
    }
}
