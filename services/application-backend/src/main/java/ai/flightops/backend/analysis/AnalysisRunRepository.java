package ai.flightops.backend.analysis;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

public interface AnalysisRunRepository extends JpaRepository<AnalysisRun, Long> {

    List<AnalysisRun> findByFlightIdOrderByIdDesc(Long flightId);

    Optional<AnalysisRun> findFirstByFlightIdAndStatusOrderByIdDesc(Long flightId, AnalysisRun.Status status);

    List<AnalysisRun> findByStatusIn(Collection<AnalysisRun.Status> statuses);
}
