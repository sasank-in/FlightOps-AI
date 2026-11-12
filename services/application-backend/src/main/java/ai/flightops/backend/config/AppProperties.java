package ai.flightops.backend.config;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Typed {@code flightops.*} configuration (see application.yml). */
@ConfigurationProperties(prefix = "flightops")
public record AppProperties(
        Database database,
        Security security,
        Bootstrap bootstrap,
        Inference inference,
        Upload upload,
        Analysis analysis,
        Llm llm,
        Reports reports) {

    public record Database(String url, String nameOverride) {}

    public record Security(String jwtSecret, Duration tokenTtl, int maxFailedLogins, Duration lockout) {}

    public record Bootstrap(String adminUsername, String adminPassword) {}

    public record Inference(String baseUrl, int batchSize, Duration connectTimeout, Duration readTimeout) {}

    public record Upload(int maxWindows, long maxBodyBytes) {}

    public record Analysis(int maxStartsPerMinute, int workerThreads, int queueCapacity) {}

    /**
     * OpenAI-compatible chat-completions provider for report narratives. {@code provider} "none" (or a
     * missing key) disables the language model; reports are then written by the deterministic template.
     */
    public record Llm(String provider, String apiKey, String baseUrl, String model, Duration timeout,
                      int maxCompletionTokens) {

        public boolean enabled() {
            return provider != null && !provider.isBlank() && !provider.equalsIgnoreCase("none")
                    && apiKey != null && !apiKey.isBlank();
        }

        @Override
        public String toString() {      // never log the key
            return "Llm[provider=" + provider + ", model=" + model + ", baseUrl=" + baseUrl + ", key="
                    + (apiKey == null || apiKey.isBlank() ? "unset" : "set") + "]";
        }
    }

    public record Reports(int maxPerMinute, int workerThreads, int queueCapacity, int maxEvidenceWindows) {}
}
