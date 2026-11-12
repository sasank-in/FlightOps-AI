package ai.flightops.backend.flight;

import java.util.Collection;
import java.util.List;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface FlightRepository extends JpaRepository<Flight, Long> {

    Page<Flight> findByOwnerId(Long ownerId, Pageable pageable);

    Page<Flight> findByExternalFlightReferenceContainingIgnoreCase(String q, Pageable pageable);

    Page<Flight> findByOwnerIdAndExternalFlightReferenceContainingIgnoreCase(Long ownerId, String q, Pageable pageable);

    /** Most recent analysis run (any status) of each given flight: one query for a whole page. */
    @Query(value = """
            select distinct on (r.flight_id)
                   r.flight_id as "flightId", r.id as "analysisId", r.status as "status",
                   (r.metrics_json ->> 'n_above_threshold')::int as "nAboveThreshold",
                   (r.metrics_json ->> 'n_windows')::int as "nWindows"
            from analysis_runs r
            where r.flight_id in (:ids)
            order by r.flight_id, r.id desc
            """, nativeQuery = true)
    List<LatestRun> findLatestRuns(@Param("ids") Collection<Long> ids);

    interface LatestRun {
        Long getFlightId();

        Long getAnalysisId();

        String getStatus();

        Integer getNAboveThreshold();

        Integer getNWindows();
    }
}
