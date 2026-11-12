package ai.flightops.backend;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import ai.flightops.backend.flight.TelemetrySchema;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Full-stack tests: real HTTP on a random port, real PostgreSQL (flightops_test), stub inference API.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
public abstract class IntegrationTestBase {

    protected static final String ADMIN_PASSWORD = "test-admin-password-123";
    protected static final JsonMapper JSON = JsonMapper.builder().build();

    @DynamicPropertySource
    static void inference(DynamicPropertyRegistry registry) {
        registry.add("flightops.inference.base-url", StubInferenceServer::url);
        registry.add("flightops.llm.base-url", StubLlmServer::url);
        registry.add("flightops.llm.provider", () -> "stub");
        registry.add("flightops.llm.api-key", () -> "test-llm-key");
        registry.add("flightops.llm.model", () -> "stub-llm");
    }

    @Autowired
    protected Environment env;
    @Autowired
    protected JdbcTemplate jdbc;

    protected final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @BeforeEach
    void cleanDatabase() {
        jdbc.execute("truncate reports, anomaly_events, analysis_runs, telemetry_windows, flights, audit_events restart identity cascade");
        jdbc.update("delete from users where username <> 'admin'");
        jdbc.update("update users set enabled = true where username = 'admin'");
        StubInferenceServer.mode = StubInferenceServer.Mode.OK;
        StubLlmServer.mode = StubLlmServer.Mode.MIXED;
    }

    protected record Resp(int status, JsonNode body, HttpResponse<String> raw) {}

    protected String url(String path) {
        return "http://127.0.0.1:" + env.getProperty("local.server.port") + path;
    }

    protected Resp send(String method, String path, String token, Object body) {
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url(path))).timeout(Duration.ofSeconds(30));
            if (token != null) {
                b.header("Authorization", "Bearer " + token);
            }
            if (body == null) {
                b.method(method, HttpRequest.BodyPublishers.noBody());
            } else {
                String text = body instanceof String s ? s : JSON.writeValueAsString(body);
                b.header("Content-Type", "application/json").method(method, HttpRequest.BodyPublishers.ofString(text));
            }
            HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
            boolean isJson = r.headers().firstValue("Content-Type").map(t -> t.contains("json")).orElse(true);
            JsonNode json = r.body() == null || r.body().isBlank() || !isJson ? null : JSON.readTree(r.body());
            return new Resp(r.statusCode(), json, r);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    protected String login(String username, String password) {
        Resp r = send("POST", "/api/v1/auth/login", null, Map.of("username", username, "password", password));
        if (r.status() != 200) {
            throw new AssertionError("login failed: " + r.status() + " " + r.body());
        }
        return r.body().get("access_token").asString();
    }

    protected String adminToken() {
        return login("admin", ADMIN_PASSWORD);
    }

    protected String createUser(String adminToken, String username, String role) {
        Resp r = send("POST", "/api/v1/users", adminToken,
                Map.of("username", username, "password", "analyst-password-123", "role", role));
        if (r.status() != 201) {
            throw new AssertionError("create user failed: " + r.status() + " " + r.body());
        }
        return login(username, "analyst-password-123");
    }

    /** Valid telemetry: 20 variables x 160 samples; airspeed starts at {@code airspeed0}. */
    protected static Map<String, List<Double>> telemetry(double airspeed0) {
        Map<String, List<Double>> t = new LinkedHashMap<>();
        for (String name : TelemetrySchema.VARIABLES) {
            List<Double> series = new ArrayList<>(TelemetrySchema.TIMESTEPS);
            for (int i = 0; i < TelemetrySchema.TIMESTEPS; i++) {
                series.add(name.equals("airspeed") ? airspeed0 - i * 0.3 : Math.sin(i / 10.0));
            }
            t.put(name, series);
        }
        return t;
    }

    protected static Map<String, Object> uploadBody(String ref, double... airspeedPerWindow) {
        List<Map<String, Object>> windows = new ArrayList<>();
        for (int i = 0; i < airspeedPerWindow.length; i++) {
            windows.add(Map.of("windowStartSeconds", i * 160, "telemetry", telemetry(airspeedPerWindow[i])));
        }
        return Map.of("externalFlightReference", ref, "datasetId", "test", "metadata", Map.of("aircraft", "T1"),
                "windows", windows);
    }

    protected long upload(String token, String ref, double... airspeedPerWindow) {
        Resp r = send("POST", "/api/v1/flights/upload", token, uploadBody(ref, airspeedPerWindow));
        if (r.status() != 201) {
            throw new AssertionError("upload failed: " + r.status() + " " + r.body());
        }
        return r.body().get("id").asLong();
    }

    protected JsonNode awaitAnalysis(String token, long analysisId) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 20_000;
        while (System.currentTimeMillis() < deadline) {
            JsonNode body = send("GET", "/api/v1/analyses/" + analysisId, token, null).body();
            String status = body.get("status").asString();
            if (status.equals("COMPLETED") || status.equals("FAILED")) {
                return body;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("analysis did not finish in time");
    }

    protected JsonNode awaitReport(String token, long reportId) throws InterruptedException {
        long deadline = System.currentTimeMillis() + 20_000;
        while (System.currentTimeMillis() < deadline) {
            JsonNode body = send("GET", "/api/v1/reports/" + reportId, token, null).body();
            String status = body.get("status").asString();
            if (status.equals("COMPLETED") || status.equals("FAILED")) {
                return body;
            }
            Thread.sleep(100);
        }
        throw new AssertionError("report did not finish in time");
    }

    /** Uploads a flight, analyses it and waits; returns {flightId, analysisId}. */
    protected long[] analysedFlight(String token, String ref, double... airspeedPerWindow) throws InterruptedException {
        long flight = upload(token, ref, airspeedPerWindow);
        long run = send("POST", "/api/v1/flights/" + flight + "/analyses", token, null).body().get("id").asLong();
        awaitAnalysis(token, run);
        return new long[] {flight, run};
    }
}
