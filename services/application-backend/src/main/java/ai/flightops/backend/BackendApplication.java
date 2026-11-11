package ai.flightops.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * FlightOps AI application backend (Phase 5).
 *
 * <p>Experimental analytics only: results are statistical deviations from nominal approaches and
 * are not inputs to flight-safety, dispatch or maintenance decisions.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class BackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(BackendApplication.class, args);
    }
}
