package ai.flightops.backend.analysis;

import java.net.http.HttpClient;
import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

import ai.flightops.backend.config.AppProperties;

import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import tools.jackson.databind.JsonNode;

/** Client for the Phase 4 inference API ({@code POST /v1/score}, services/inference-api). */
@Component
public class InferenceClient {

    public record ScoreWindow(@JsonProperty("flight_id") String flightId,
                              @JsonProperty("window_start_seconds") int windowStartSeconds,
                              JsonNode telemetry) {}

    public record ScoreRequest(List<ScoreWindow> windows) {}

    public record ScoredEvent(@JsonProperty("flight_id") String flightId,
                              @JsonProperty("window_start_seconds") int windowStartSeconds,
                              @JsonProperty("window_end_seconds") int windowEndSeconds,
                              @JsonProperty("model_name") String modelName,
                              @JsonProperty("model_version") String modelVersion,
                              @JsonProperty("anomaly_score") double anomalyScore,
                              double threshold,
                              @JsonProperty("is_anomaly") boolean anomaly,
                              @JsonProperty("supporting_features") JsonNode supportingFeatures,
                              @JsonProperty("quality_flags") JsonNode qualityFlags,
                              @JsonProperty("score_components") JsonNode scoreComponents,
                              String interpretation) {}

    public record ScoreResponse(@JsonProperty("request_id") String requestId,
                                @JsonProperty("model_name") String modelName,
                                @JsonProperty("model_version") String modelVersion,
                                List<ScoredEvent> events) {}

    private final RestClient client;

    public InferenceClient(RestClient.Builder builder, AppProperties props) {
        AppProperties.Inference cfg = props.inference();
        // HTTP/1.1: the inference service (uvicorn) does not speak HTTP/2, so avoid the h2c upgrade attempt.
        HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(cfg.connectTimeout()).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(cfg.readTimeout());
        this.client = builder.baseUrl(cfg.baseUrl()).requestFactory(factory).build();
    }

    public ScoreResponse score(List<ScoreWindow> windows) {
        return client.post()
                .uri("/v1/score")
                .contentType(MediaType.APPLICATION_JSON)
                .accept(MediaType.APPLICATION_JSON)
                .body(new ScoreRequest(windows))
                .retrieve()
                .body(ScoreResponse.class);
    }
}
