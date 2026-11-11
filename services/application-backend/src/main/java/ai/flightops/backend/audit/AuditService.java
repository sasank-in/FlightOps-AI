package ai.flightops.backend.audit;

import java.util.List;

import ai.flightops.backend.audit.AuditEvent.Outcome;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Append-only audit trail. Each record is written in its own transaction, so denied or failed
 * actions are still recorded when the surrounding transaction rolls back. Details never contain
 * passwords, tokens or telemetry.
 */
@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);
    private final AuditRepository repo;

    public AuditService(AuditRepository repo) {
        this.repo = repo;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(String username, String action, String entityType, Object entityId, Outcome outcome, String detail) {
        try {
            repo.save(new AuditEvent(username, action, entityType, entityId == null ? null : String.valueOf(entityId), outcome, detail));
        } catch (RuntimeException e) {   // auditing must never break the request, but must be visible
            log.error("Failed to write audit event action={} outcome={}", action, outcome, e);
        }
    }

    @Transactional(readOnly = true)
    public List<AuditEvent> latest(int limit) {
        return repo.findAllByOrderByIdDesc(PageRequest.of(0, Math.max(1, Math.min(limit, 500))));
    }
}
