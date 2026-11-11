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
        Analysis analysis) {

    public record Database(String url, String nameOverride) {}

    public record Security(String jwtSecret, Duration tokenTtl, int maxFailedLogins, Duration lockout) {}

    public record Bootstrap(String adminUsername, String adminPassword) {}

    public record Inference(String baseUrl, int batchSize, Duration connectTimeout, Duration readTimeout) {}

    public record Upload(int maxWindows, long maxBodyBytes) {}

    public record Analysis(int maxStartsPerMinute, int workerThreads, int queueCapacity) {}
}
