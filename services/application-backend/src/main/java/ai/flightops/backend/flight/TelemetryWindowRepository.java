package ai.flightops.backend.flight;

import java.util.List;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

public interface TelemetryWindowRepository extends JpaRepository<TelemetryWindow, Long> {

    List<TelemetryWindow> findByFlightIdOrderByWindowIndex(Long flightId);

    Optional<TelemetryWindow> findByFlightIdAndWindowIndex(Long flightId, int windowIndex);

    /** Closed projection: window positions only, without loading the telemetry JSON. */
    List<WindowRef> findRefsByFlightIdOrderByWindowIndex(Long flightId);

    interface WindowRef {
        int getWindowIndex();

        int getWindowStartSeconds();
    }
}
