package ai.flightops.backend;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import com.sun.net.httpserver.HttpServer;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Stand-in for an OpenAI-compatible chat-completions API. In MIXED mode it answers with one grounded
 * finding per kind and three that the validator must remove (invented number, maintenance advice,
 * unknown ref), built from the evidence package it receives.
 */
public final class StubLlmServer {

    public enum Mode { MIXED, ALL_INVALID, NOT_JSON, HTTP_500, RATE_LIMITED_ONCE }

    public static volatile Mode mode = Mode.MIXED;
    public static final AtomicReference<String> lastAuthorization = new AtomicReference<>();
    public static final AtomicReference<JsonNode> lastRequest = new AtomicReference<>();
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static HttpServer server;

    private StubLlmServer() {}

    public static synchronized String url() {
        if (server == null) {
            start();
        }
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
    }

    private static void start() {
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
        server.createContext("/v1/chat/completions", exchange -> {
            lastAuthorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            JsonNode req = JSON.readTree(exchange.getRequestBody().readAllBytes());
            lastRequest.set(req);
            int status = 200;
            byte[] body;
            if (mode == Mode.RATE_LIMITED_ONCE) {
                mode = Mode.MIXED;                        // the retry gets a normal answer
                exchange.getResponseHeaders().add("Retry-After", "1");
                byte[] limited = "{\"error\":{\"message\":\"rate limit\"}}".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(429, limited.length);
                try (OutputStream os = exchange.getResponseBody()) {
                    os.write(limited);
                }
                return;
            }
            if (mode == Mode.HTTP_500) {
                status = 500;
                body = "{\"error\":{\"message\":\"boom\"}}".getBytes(StandardCharsets.UTF_8);
            } else {
                JsonNode evidence = JSON.readTree(req.get("messages").get(1).get("content").asString());
                String answer = mode == Mode.NOT_JSON ? "Sorry, here is prose instead of JSON." : answer(evidence);
                ObjectNode resp = JSON.createObjectNode();
                resp.put("model", "stub-llm-1");
                ObjectNode choice = resp.putArray("choices").addObject();
                choice.put("finish_reason", "stop");
                choice.putObject("message").put("role", "assistant").put("content", answer);
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

    private static String answer(JsonNode ev) {
        JsonNode run = ev.get("analysis");
        JsonNode top = ev.get("windows").get(0);
        ObjectNode out = JSON.createObjectNode();
        ArrayNode f = out.putArray("findings");
        if (mode == Mode.MIXED) {
            out.put("summary", run.get("n_windows_above_threshold").asString() + " of "
                    + run.get("n_windows_scored").asString() + " windows were above the threshold of "
                    + run.get("threshold").asString() + ".");
            f.addObject().put("statement", "Window " + top.get("window_index").asString() + " has the highest score, "
                    + top.get("anomaly_score").asString() + ".").put("basis", "model_output")
                    .putArray("evidence").add(top.get("ref").asString());
            f.addObject().put("statement", "Window " + top.get("window_index").asString() + " runs from second "
                    + top.get("start_seconds").asString() + " to " + top.get("end_seconds").asString() + ".")
                    .put("basis", "measured").putArray("evidence").add(top.get("ref").asString());
        } else {
            out.put("summary", "The flight shows 7.77 knots of excess.");
        }
        f.addObject().put("statement", "Airspeed was 999.5 kt above nominal.").put("basis", "measured")
                .putArray("evidence").add(top.get("ref").asString());
        f.addObject().put("statement", "The pitot system should be inspected during maintenance.").put("basis", "interpretation")
                .putArray("evidence").add("RUN");
        f.addObject().put("statement", "Window scores are high.").put("basis", "model_output")
                .putArray("evidence").add("W999");
        return JSON.writeValueAsString(out);
    }
}
