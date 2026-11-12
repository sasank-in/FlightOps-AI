package ai.flightops.backend.flight;

import java.net.URI;

import jakarta.validation.Valid;

import ai.flightops.backend.flight.FlightDtos.FlightDetail;
import ai.flightops.backend.flight.FlightDtos.FlightSummary;
import ai.flightops.backend.flight.FlightDtos.FlightUploadRequest;
import ai.flightops.backend.flight.FlightDtos.PageResponse;
import ai.flightops.backend.flight.FlightDtos.TelemetryResponse;
import ai.flightops.backend.user.UserContext;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/flights")
public class FlightController {

    private final FlightService service;
    private final UserContext userContext;

    public FlightController(FlightService service, UserContext userContext) {
        this.service = service;
        this.userContext = userContext;
    }

    @PostMapping("/upload")
    public ResponseEntity<FlightSummary> upload(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody FlightUploadRequest req) {
        FlightSummary created = service.upload(req, userContext.resolve(jwt));
        return ResponseEntity.created(URI.create("/api/v1/flights/" + created.id())).body(created);
    }

    @GetMapping
    public PageResponse<FlightSummary> list(@AuthenticationPrincipal Jwt jwt,
                                            @RequestParam(defaultValue = "0") int page,
                                            @RequestParam(defaultValue = "20") int size,
                                            @RequestParam(required = false) String q) {
        return service.list(userContext.resolve(jwt), page, size, q);
    }

    @GetMapping("/{id}")
    public FlightDetail detail(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return service.detail(id, userContext.resolve(jwt));
    }

    @GetMapping("/{id}/telemetry")
    public TelemetryResponse telemetry(@AuthenticationPrincipal Jwt jwt, @PathVariable long id,
                                       @RequestParam(defaultValue = "0") int window) {
        return service.telemetry(id, window, userContext.resolve(jwt));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        service.delete(id, userContext.resolve(jwt));
        return ResponseEntity.noContent().build();
    }
}
