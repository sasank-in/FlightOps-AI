package ai.flightops.backend.flight;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import ai.flightops.backend.audit.AuditEvent.Outcome;
import ai.flightops.backend.audit.AuditService;
import ai.flightops.backend.common.ApiException;
import ai.flightops.backend.config.AppProperties;
import ai.flightops.backend.flight.FlightDtos.FlightDetail;
import ai.flightops.backend.flight.FlightDtos.FlightSummary;
import ai.flightops.backend.flight.FlightDtos.FlightUploadRequest;
import ai.flightops.backend.flight.FlightDtos.PageResponse;
import ai.flightops.backend.flight.FlightDtos.TelemetryResponse;
import ai.flightops.backend.flight.FlightDtos.WindowInfo;
import ai.flightops.backend.flight.FlightDtos.WindowUpload;
import ai.flightops.backend.user.CurrentUser;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.json.JsonMapper;

@Service
public class FlightService {

    static final int MAX_METADATA_BYTES = 16_384;
    static final int MAX_PAGE_SIZE = 100;

    private final FlightRepository flights;
    private final TelemetryWindowRepository windows;
    private final JsonMapper json;
    private final AppProperties props;
    private final AuditService audit;

    public FlightService(FlightRepository flights, TelemetryWindowRepository windows, JsonMapper json,
                         AppProperties props, AuditService audit) {
        this.flights = flights;
        this.windows = windows;
        this.json = json;
        this.props = props;
        this.audit = audit;
    }

    @Transactional
    public FlightSummary upload(FlightUploadRequest req, CurrentUser user) {
        int maxWindows = props.upload().maxWindows();
        if (req.windows().size() > maxWindows) {
            throw ApiException.badRequest("At most " + maxWindows + " windows per upload");
        }
        for (int i = 0; i < req.windows().size(); i++) {
            TelemetrySchema.validate(req.windows().get(i).telemetry(), i);
        }
        Map<String, Object> metadata = req.metadata() == null ? Map.of() : req.metadata();
        String metadataJson = json.writeValueAsString(metadata);
        if (metadataJson.getBytes(StandardCharsets.UTF_8).length > MAX_METADATA_BYTES) {
            throw ApiException.badRequest("metadata exceeds " + MAX_METADATA_BYTES + " bytes");
        }
        Flight flight = flights.save(new Flight(req.externalFlightReference(), blankToNull(req.datasetId()),
                user.id(), metadataJson, req.windows().size()));
        for (int i = 0; i < req.windows().size(); i++) {
            WindowUpload w = req.windows().get(i);
            windows.save(new TelemetryWindow(flight.getId(), i, w.windowStartSeconds(), json.writeValueAsString(w.telemetry())));
        }
        audit.record(user.username(), "FLIGHT_UPLOAD", "flight", flight.getId(), Outcome.SUCCESS,
                "windows=" + req.windows().size());
        return FlightSummary.of(flight);
    }

    @Transactional(readOnly = true)
    public PageResponse<FlightSummary> list(CurrentUser user, int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw ApiException.badRequest("page must be >= 0 and size between 1 and " + MAX_PAGE_SIZE);
        }
        PageRequest pr = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "createdAt").and(Sort.by(Sort.Direction.DESC, "id")));
        Page<Flight> result = user.isAdmin() ? flights.findAll(pr) : flights.findByOwnerId(user.id(), pr);
        return new PageResponse<>(result.map(FlightSummary::of).getContent(), page, size,
                result.getTotalElements(), result.getTotalPages());
    }

    /** Returns the flight if the user may see it; otherwise 404 (existence is not revealed). */
    @Transactional(readOnly = true)
    public Flight getAuthorized(long flightId, CurrentUser user) {
        Flight f = flights.findById(flightId).orElseThrow(() -> ApiException.notFound("Flight"));
        if (!user.canAccess(f.getOwnerId())) {
            audit.record(user.username(), "FLIGHT_ACCESS", "flight", flightId, Outcome.DENIED, "not owner");
            throw ApiException.notFound("Flight");
        }
        return f;
    }

    @Transactional(readOnly = true)
    public FlightDetail detail(long flightId, CurrentUser user) {
        Flight f = getAuthorized(flightId, user);
        List<WindowInfo> refs = windows.findRefsByFlightIdOrderByWindowIndex(flightId).stream()
                .map(r -> new WindowInfo(r.getWindowIndex(), r.getWindowStartSeconds(),
                        r.getWindowStartSeconds() + TelemetrySchema.TIMESTEPS - 1))
                .toList();
        return new FlightDetail(FlightSummary.of(f), json.readTree(f.getMetadataJson()), refs);
    }

    @Transactional(readOnly = true)
    public TelemetryResponse telemetry(long flightId, int windowIndex, CurrentUser user) {
        getAuthorized(flightId, user);
        TelemetryWindow w = windows.findByFlightIdAndWindowIndex(flightId, windowIndex)
                .orElseThrow(() -> ApiException.notFound("Window"));
        return new TelemetryResponse(flightId, w.getWindowIndex(), w.getWindowStartSeconds(),
                w.getWindowStartSeconds() + TelemetrySchema.TIMESTEPS - 1, json.readTree(w.getData()));
    }

    @Transactional
    public void delete(long flightId, CurrentUser user) {
        Flight f = getAuthorized(flightId, user);
        flights.delete(f);   // windows, analyses and events cascade in the database
        audit.record(user.username(), "FLIGHT_DELETE", "flight", flightId, Outcome.SUCCESS, null);
    }

    private static String blankToNull(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }
}
