package ai.flightops.backend.analysis;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AnomalyEventRepository extends JpaRepository<AnomalyEvent, Long> {

    List<AnomalyEvent> findByAnalysisRunIdOrderByWindowIndex(Long analysisRunId);
}
