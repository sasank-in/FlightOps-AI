package ai.flightops.backend.flight;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import tools.jackson.databind.JsonNode;

/** Request/response bodies for the flight API. */
public final class FlightDtos {

    private FlightDtos() {}

    public record WindowUpload(
            @NotNull @Min(0) @Max(10_000_000) Integer windowStartSeconds,
            @NotNull Map<String, List<Double>> telemetry) {}

    public record FlightUploadRequest(
            @NotBlank @Size(max = 128) @Pattern(regexp = "^[A-Za-z0-9._:/-]+$",
                    message = "letters, digits and . _ : / - only") String externalFlightReference,
            @Size(max = 128) String datasetId,
            Map<String, Object> metadata,
            @NotEmpty List<@Valid WindowUpload> windows) {}

    /** Latest analysis run of a flight, for list views (null counts until the run completes). */
    public record LatestAnalysis(long id, String status, Integer nAboveThreshold, Integer nWindows) {}

    public record FlightSummary(long id, String externalFlightReference, String datasetId, int nWindows,
                                long ownerId, Instant createdAt, LatestAnalysis latestAnalysis) {
        static FlightSummary of(Flight f) {
            return of(f, null);
        }

        static FlightSummary of(Flight f, LatestAnalysis latest) {
            return new FlightSummary(f.getId(), f.getExternalFlightReference(), f.getDatasetId(), f.getNWindows(),
                    f.getOwnerId(), f.getCreatedAt(), latest);
        }
    }

    public record WindowInfo(int windowIndex, int windowStartSeconds, int windowEndSeconds) {}

    public record FlightDetail(FlightSummary flight, JsonNode metadata, List<WindowInfo> windows) {}

    public record TelemetryResponse(long flightId, int windowIndex, int windowStartSeconds, int windowEndSeconds,
                                    JsonNode telemetry) {}

    public record PageResponse<T>(List<T> items, int page, int size, long totalItems, int totalPages) {}
}
