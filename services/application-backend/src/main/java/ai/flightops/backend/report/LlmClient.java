package ai.flightops.backend.report;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import ai.flightops.backend.config.AppProperties;

import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import tools.jackson.databind.JsonNode;

/**
 * OpenAI-compatible chat-completions client (Groq by default). Requests JSON-object output and retries
 * once on HTTP 429 when the provider asks for a short wait. Errors surface as {@link LlmException} with
 * a safe message: the API key, prompt and response body are never part of it.
 */
@Component
public class LlmClient {

    public static class LlmException extends RuntimeException {
        public LlmException(String safeMessage) {
            super(safeMessage);
        }
    }

    public record Completion(String content, String model) {}

    static final long MAX_RETRY_WAIT_SECONDS = 20;

    private final AppProperties.Llm cfg;
    private final RestClient client;

    public LlmClient(RestClient.Builder builder, AppProperties props) {
        this.cfg = props.llm();
        HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(cfg.timeout());
        String base = cfg.baseUrl() == null ? "" : cfg.baseUrl().replaceAll("/+$", "");
        this.client = builder.clone().baseUrl(base).requestFactory(factory).build();
    }

    public boolean enabled() {
        return cfg.enabled();
    }

    public String provider() {
        return cfg.provider();
    }

    public Completion complete(String system, String user) {
        if (!enabled()) {
            throw new LlmException("Language model is not configured");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", cfg.model());
        body.put("messages", List.of(Map.of("role", "system", "content", system), Map.of("role", "user", "content", user)));
        body.put("temperature", 0.2);
        body.put("max_completion_tokens", cfg.maxCompletionTokens());
        body.put("response_format", Map.of("type", "json_object"));
        if (cfg.model() != null && cfg.model().startsWith("openai/gpt-oss")) {
            body.put("reasoning_effort", "medium");      // Groq reasoning models; other models reject the field
        }
        try {
            return parse(postWithOneRetry(body));
        } catch (RestClientResponseException e) {
            int status = e.getStatusCode().value();
            throw new LlmException(status == 429 ? "Language model rate limit reached (HTTP 429)"
                    : status == 401 || status == 403 ? "Language model rejected the credentials (HTTP " + status + ")"
                    : "Language model request failed (HTTP " + status + ")");
        } catch (ResourceAccessException e) {
            throw new LlmException("Language model unavailable or timed out");
        } catch (LlmException e) {
            throw e;
        } catch (RuntimeException e) {
            throw new LlmException("Language model returned an unreadable response");
        }
    }

    private JsonNode postWithOneRetry(Map<String, Object> body) {
        try {
            return post(body);
        } catch (RestClientResponseException e) {
            long wait = e.getStatusCode().value() == 429 ? retryAfterSeconds(e) : -1;
            if (wait < 0 || wait > MAX_RETRY_WAIT_SECONDS) {
                throw e;
            }
            try {
                Thread.sleep(wait * 1000L);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new LlmException("Language model request interrupted");
            }
            return post(body);
        }
    }

    private JsonNode post(Map<String, Object> body) {
        return client.post().uri("/chat/completions")
                .header("Authorization", "Bearer " + cfg.apiKey())
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(JsonNode.class);
    }

    /** Retry-After in whole seconds (rounded up); 2 when absent; -1 when not a number of seconds. */
    static long retryAfterSeconds(RestClientResponseException e) {
        String h = e.getResponseHeaders() == null ? null : e.getResponseHeaders().getFirst("Retry-After");
        if (h == null || h.isBlank()) {
            return 2;
        }
        try {
            return Math.max(1, (long) Math.ceil(Double.parseDouble(h.trim())));
        } catch (NumberFormatException ex) {
            return -1;
        }
    }

    private Completion parse(JsonNode resp) {
        JsonNode choice = resp == null ? null : resp.path("choices").path(0);
        if (choice == null || choice.isMissingNode()) {
            throw new LlmException("Language model returned no answer");
        }
        if ("length".equals(choice.path("finish_reason").asString(""))) {
            throw new LlmException("Language model answer was cut off (token limit)");
        }
        String content = choice.path("message").path("content").asString("");
        if (content.isBlank()) {
            throw new LlmException("Language model returned an empty answer");
        }
        return new Completion(content, resp.path("model").asString(cfg.model()));
    }
}
