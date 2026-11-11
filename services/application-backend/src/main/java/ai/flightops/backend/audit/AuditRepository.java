package ai.flightops.backend.audit;

import java.util.List;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AuditRepository extends JpaRepository<AuditEvent, Long> {

    List<AuditEvent> findAllByOrderByIdDesc(Pageable pageable);
}
