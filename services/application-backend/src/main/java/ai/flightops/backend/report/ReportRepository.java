package ai.flightops.backend.report;

import java.util.Collection;
import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ReportRepository extends JpaRepository<Report, Long> {

    List<Report> findByFlightIdOrderByIdDesc(Long flightId);

    List<Report> findByStatusIn(Collection<Report.Status> statuses);
}
