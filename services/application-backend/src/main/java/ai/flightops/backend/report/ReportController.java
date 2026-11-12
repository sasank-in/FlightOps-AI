package ai.flightops.backend.report;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.List;

import ai.flightops.backend.report.ReportService.ReportResponse;
import ai.flightops.backend.report.ReportService.ReportSummary;
import ai.flightops.backend.user.UserContext;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class ReportController {

    public record CreateReportRequest(@NotNull @Positive Long analysisId) {}

    private final ReportService service;
    private final UserContext userContext;

    public ReportController(ReportService service, UserContext userContext) {
        this.service = service;
        this.userContext = userContext;
    }

    /** Starts report generation: 202 Accepted; poll GET /api/v1/reports/{id}. */
    @PostMapping("/reports")
    public ResponseEntity<ReportResponse> create(@AuthenticationPrincipal Jwt jwt,
                                                 @Valid @RequestBody CreateReportRequest body) {
        ReportResponse r = service.create(body.analysisId(), userContext.resolve(jwt));
        return ResponseEntity.accepted().location(URI.create("/api/v1/reports/" + r.id())).body(r);
    }

    @GetMapping("/reports/{id}")
    public ReportResponse get(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return service.get(id, userContext.resolve(jwt));
    }

    @GetMapping("/flights/{flightId}/reports")
    public List<ReportSummary> list(@AuthenticationPrincipal Jwt jwt, @PathVariable long flightId) {
        return service.listForFlight(flightId, userContext.resolve(jwt));
    }

    /** The report as a Markdown document (download). */
    @GetMapping("/reports/{id}/markdown")
    public ResponseEntity<String> markdown(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        ReportService.Markdown md = service.markdown(id, userContext.resolve(jwt));
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "markdown", StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(md.filename(), StandardCharsets.UTF_8).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(md.body());
    }
}
