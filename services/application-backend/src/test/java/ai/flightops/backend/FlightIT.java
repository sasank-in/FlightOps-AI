package ai.flightops.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.JsonNode;

class FlightIT extends IntegrationTestBase {

    @Test
    void uploadListDetailAndTelemetryRoundTrip() {
        String analyst = createUser(adminToken(), "alice", "ANALYST");
        Resp created = send("POST", "/api/v1/flights/upload", analyst, uploadBody("FLT-001", 150, 230));
        assertThat(created.status()).isEqualTo(201);
        long id = created.body().get("id").asLong();
        assertThat(created.raw().headers().firstValue("Location")).hasValue("/api/v1/flights/" + id);
        assertThat(created.body().get("nWindows").asInt()).isEqualTo(2);

        JsonNode page = send("GET", "/api/v1/flights?page=0&size=10", analyst, null).body();
        assertThat(page.get("totalItems").asLong()).isEqualTo(1);
        assertThat(page.get("items").get(0).get("externalFlightReference").asString()).isEqualTo("FLT-001");

        JsonNode detail = send("GET", "/api/v1/flights/" + id, analyst, null).body();
        assertThat(detail.get("metadata").get("aircraft").asString()).isEqualTo("T1");
        assertThat(detail.get("windows").get(1).get("windowStartSeconds").asInt()).isEqualTo(160);
        assertThat(detail.get("windows").get(1).get("windowEndSeconds").asInt()).isEqualTo(319);

        JsonNode tel = send("GET", "/api/v1/flights/" + id + "/telemetry?window=1", analyst, null).body();
        assertThat(tel.get("telemetry").size()).isEqualTo(20);
        assertThat(tel.get("telemetry").get("airspeed").get(0).asDouble()).isEqualTo(230.0);
        assertThat(tel.get("telemetry").get("airspeed").size()).isEqualTo(160);
        assertThat(send("GET", "/api/v1/flights/" + id + "/telemetry?window=7", analyst, null).status()).isEqualTo(404);
    }

    @Test
    void analystsOnlySeeTheirOwnFlightsAdminsSeeAll() {
        String admin = adminToken();
        String alice = createUser(admin, "alice", "ANALYST");
        String bob = createUser(admin, "bob", "ANALYST");
        long aliceFlight = upload(alice, "ALICE-1", 150);

        assertThat(send("GET", "/api/v1/flights/" + aliceFlight, bob, null).status()).isEqualTo(404);   // not 403: no leak
        assertThat(send("GET", "/api/v1/flights/" + aliceFlight + "/telemetry", bob, null).status()).isEqualTo(404);
        assertThat(send("POST", "/api/v1/flights/" + aliceFlight + "/analyses", bob, null).status()).isEqualTo(404);
        assertThat(send("DELETE", "/api/v1/flights/" + aliceFlight, bob, null).status()).isEqualTo(404);
        assertThat(send("GET", "/api/v1/flights", bob, null).body().get("totalItems").asLong()).isZero();

        assertThat(send("GET", "/api/v1/flights/" + aliceFlight, admin, null).status()).isEqualTo(200);
        assertThat(send("GET", "/api/v1/flights", admin, null).body().get("totalItems").asLong()).isEqualTo(1);
        assertThat(jdbc.queryForObject("select count(*) from audit_events where action='FLIGHT_ACCESS' and outcome='DENIED'",
                Long.class)).isGreaterThanOrEqualTo(1);
    }

    @Test
    void invalidTelemetryIsRejectedWithoutEchoingValues() {
        String token = adminToken();

        Map<String, Object> missingVar = uploadBody("BAD-1", 150);
        @SuppressWarnings("unchecked")
        Map<String, List<Double>> tel = (Map<String, List<Double>>) ((List<Map<String, Object>>) missingVar.get("windows")).get(0).get("telemetry");
        tel.remove("flap");
        Resp r1 = send("POST", "/api/v1/flights/upload", token, missingVar);
        assertThat(r1.status()).isEqualTo(400);
        assertThat(r1.body().get("detail").asString()).contains("missing=[flap]");

        Map<String, Object> shortSeries = uploadBody("BAD-2", 150);
        @SuppressWarnings("unchecked")
        Map<String, List<Double>> tel2 = (Map<String, List<Double>>) ((List<Map<String, Object>>) shortSeries.get("windows")).get(0).get("telemetry");
        tel2.put("airspeed", tel2.get("airspeed").subList(0, 159));
        Resp r2 = send("POST", "/api/v1/flights/upload", token, shortSeries);
        assertThat(r2.status()).isEqualTo(400);
        assertThat(r2.body().get("detail").asString()).contains("'airspeed' must have exactly 160 values");

        String nanBody = JSON.writeValueAsString(uploadBody("BAD-3", 150)).replaceFirst("150\\.0", "NaN");
        Resp r3 = send("POST", "/api/v1/flights/upload", token, nanBody);
        assertThat(r3.status()).isEqualTo(400);

        String hugeNumber = JSON.writeValueAsString(uploadBody("BAD-4", 150)).replaceFirst("150\\.0", "1e400");
        Resp r4 = send("POST", "/api/v1/flights/upload", token, hugeNumber);
        assertThat(r4.status()).isEqualTo(400);
        assertThat(r4.raw().body()).doesNotContain("1e400");

        Resp r5 = send("POST", "/api/v1/flights/upload", token, uploadBody("bad ref with spaces", 150));
        assertThat(r5.status()).isEqualTo(400);

        assertThat(jdbc.queryForObject("select count(*) from flights", Long.class)).isZero();   // nothing partially saved
    }

    @Test
    void uploadLimitsAreEnforced() {
        String token = adminToken();
        Resp tooMany = send("POST", "/api/v1/flights/upload", token, uploadBody("MANY", 1, 2, 3, 4, 5, 6));
        assertThat(tooMany.status()).isEqualTo(400);              // test profile: max 5 windows
        assertThat(tooMany.body().get("detail").asString()).contains("At most 5 windows");

        String big = "{\"externalFlightReference\":\"BIG\",\"windows\":[],\"pad\":\"" + "x".repeat(2_100_000) + "\"}";
        assertThat(send("POST", "/api/v1/flights/upload", token, big).status()).isEqualTo(413);
    }

    @Test
    void deletingAFlightRemovesItsWindowsAndAnalyses() throws InterruptedException {
        String token = adminToken();
        long id = upload(token, "DEL-1", 150, 250);
        long run = send("POST", "/api/v1/flights/" + id + "/analyses", token, null).body().get("id").asLong();
        awaitAnalysis(token, run);

        assertThat(send("DELETE", "/api/v1/flights/" + id, token, null).status()).isEqualTo(204);
        assertThat(send("GET", "/api/v1/flights/" + id, token, null).status()).isEqualTo(404);
        assertThat(jdbc.queryForObject("select count(*) from telemetry_windows", Long.class)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from analysis_runs", Long.class)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from anomaly_events", Long.class)).isZero();
    }
}
