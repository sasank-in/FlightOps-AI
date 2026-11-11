package ai.flightops.backend;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

import com.sun.net.httpserver.HttpServer;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Minimal stand-in for the Python inference API (POST /v1/score). Deterministic scoring: a window is
 * "anomalous" when its first airspeed sample exceeds 200 kt. Modes simulate failures.
 */
public final class StubInferenceServer {

    public enum Mode { OK, HTTP_500, WRONG_COUNT }

    public static volatile Mode mode = Mode.OK;
    public static final AtomicInteger calls = new AtomicInteger();
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static HttpServer server;

    private StubInferenceServer() {}

    public static synchronized String url() {
        if (server == null) {
            start();
        }
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static void start() {
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        server.createContext("/v1/model", exchange -> {
            boolean fail = mode == Mode.HTTP_500;
            byte[] body = (fail ? "{\"error\":\"boom\"}"
                    : "{\"model_name\":\"stub_model\",\"model_version\":\"9.9.9\",\"threshold\":0.2,"
                    + "\"evaluation\":{\"test_pr_auc\":0.41}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(fail ? 500 : 200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.createContext("/v1/score", exchange -> {
            calls.incrementAndGet();
            byte[] body;
            int status;
            if (mode == Mode.HTTP_500) {
                status = 500;
                body = "{\"error\":\"boom\"}".getBytes(StandardCharsets.UTF_8);
            } else {
                JsonNode req = JSON.readTree(exchange.getRequestBody().readAllBytes());
                ObjectNode resp = JSON.createObjectNode();
                resp.put("request_id", "stub");
                resp.put("model_name", "stub_model");
                resp.put("model_version", "9.9.9");
                ArrayNode events = resp.putArray("events");
                int n = 0;
                for (JsonNode w : req.get("windows")) {
                    if (mode == Mode.WRONG_COUNT && n++ > 0) {
                        break;
                    }
                    double airspeed0 = w.get("telemetry").get("airspeed").get(0).asDouble();
                    int start = w.get("window_start_seconds").asInt();
                    ObjectNode e = events.addObject();
                    e.put("flight_id", w.get("flight_id").asString());
                    e.put("window_start_seconds", start);
                    e.put("window_end_seconds", start + 159);
                    e.put("model_name", "stub_model");
                    e.put("model_version", "9.9.9");
                    e.put("anomaly_score", airspeed0 / 1000.0);
                    e.put("threshold", 0.2);
                    e.put("is_anomaly", airspeed0 > 200);
                    e.putArray("supporting_features").addObject().put("feature", "airspeed").put("statistic", "first");
                    e.putObject("quality_flags").put("pressure_invalid", false);
                    e.putNull("score_components");
                    e.put("interpretation", "stub");
                }
                status = 200;
                body = JSON.writeValueAsBytes(resp);
            }
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();
    }
}
