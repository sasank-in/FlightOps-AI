package ai.flightops.backend.audit;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "audit_events")
public class AuditEvent {

    public enum Outcome { SUCCESS, DENIED, FAILURE }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, updatable = false)
    private Instant at = Instant.now();

    @Column(length = 64)
    private String username;

    @Column(nullable = false, length = 64)
    private String action;

    @Column(name = "entity_type", length = 32)
    private String entityType;

    @Column(name = "entity_id", length = 64)
    private String entityId;

    @Column(nullable = false, length = 16)
    private String outcome;

    @Column(length = 500)
    private String detail;

    protected AuditEvent() {}

    public AuditEvent(String username, String action, String entityType, String entityId, Outcome outcome, String detail) {
        this.username = username;
        this.action = action;
        this.entityType = entityType;
        this.entityId = entityId;
        this.outcome = outcome.name();
        this.detail = detail == null ? null : detail.substring(0, Math.min(detail.length(), 500));
    }

    public Long getId() { return id; }
    public Instant getAt() { return at; }
    public String getUsername() { return username; }
    public String getAction() { return action; }
    public String getEntityType() { return entityType; }
    public String getEntityId() { return entityId; }
    public String getOutcome() { return outcome; }
    public String getDetail() { return detail; }
}
