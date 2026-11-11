package ai.flightops.backend.audit;

import java.time.Instant;
import java.util.List;

import ai.flightops.backend.user.UserContext;

import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Read-only audit log (ADMIN only; enforced in SecurityConfig). */
@RestController
@RequestMapping("/api/v1/audit")
public class AuditController {

    public record AuditResponse(long id, Instant at, String username, String action, String entityType,
                                String entityId, String outcome, String detail) {}

    private final AuditService audit;
    private final UserContext userContext;

    public AuditController(AuditService audit, UserContext userContext) {
        this.audit = audit;
        this.userContext = userContext;
    }

    @GetMapping
    public List<AuditResponse> latest(@AuthenticationPrincipal Jwt jwt, @RequestParam(defaultValue = "100") int limit) {
        userContext.resolve(jwt);
        return audit.latest(limit).stream()
                .map(e -> new AuditResponse(e.getId(), e.getAt(), e.getUsername(), e.getAction(), e.getEntityType(),
                        e.getEntityId(), e.getOutcome(), e.getDetail()))
                .toList();
    }
}
