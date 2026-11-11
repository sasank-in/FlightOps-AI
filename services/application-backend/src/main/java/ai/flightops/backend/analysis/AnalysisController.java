package ai.flightops.backend.analysis;

import java.net.URI;
import java.util.List;

import ai.flightops.backend.analysis.AnalysisService.AnalysisResponse;
import ai.flightops.backend.analysis.AnalysisService.AnomaliesResponse;
import ai.flightops.backend.user.UserContext;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class AnalysisController {

    private final AnalysisService service;
    private final UserContext userContext;

    public AnalysisController(AnalysisService service, UserContext userContext) {
        this.service = service;
        this.userContext = userContext;
    }

    /** Starts an asynchronous analysis: 202 Accepted with the run; poll GET /api/v1/analyses/{id}. */
    @PostMapping("/flights/{flightId}/analyses")
    public ResponseEntity<AnalysisResponse> start(@AuthenticationPrincipal Jwt jwt, @PathVariable long flightId) {
        AnalysisResponse run = service.start(flightId, userContext.resolve(jwt));
        return ResponseEntity.accepted().location(URI.create("/api/v1/analyses/" + run.id())).body(run);
    }

    @GetMapping("/flights/{flightId}/analyses")
    public List<AnalysisResponse> list(@AuthenticationPrincipal Jwt jwt, @PathVariable long flightId) {
        return service.listForFlight(flightId, userContext.resolve(jwt));
    }

    @GetMapping("/analyses/{id}")
    public AnalysisResponse get(@AuthenticationPrincipal Jwt jwt, @PathVariable long id) {
        return service.get(id, userContext.resolve(jwt));
    }

    @GetMapping("/flights/{flightId}/anomalies")
    public AnomaliesResponse anomalies(@AuthenticationPrincipal Jwt jwt, @PathVariable long flightId,
                                       @RequestParam(required = false) Long analysisId,
                                       @RequestParam(defaultValue = "false") boolean onlyAboveThreshold) {
        return service.anomalies(flightId, analysisId, onlyAboveThreshold, userContext.resolve(jwt));
    }
}
