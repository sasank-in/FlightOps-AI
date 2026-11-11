package ai.flightops.backend.flight;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FlightRepository extends JpaRepository<Flight, Long> {

    Page<Flight> findByOwnerId(Long ownerId, Pageable pageable);
}
