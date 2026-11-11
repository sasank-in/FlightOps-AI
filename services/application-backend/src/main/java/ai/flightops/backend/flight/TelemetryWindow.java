package ai.flightops.backend.flight;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.ColumnTransformer;

/** One 160-second window; {@code data} is a JSON object of the 20 variables (TelemetrySchema). */
@Entity
@Table(name = "telemetry_windows")
public class TelemetryWindow {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "flight_id", nullable = false)
    private Long flightId;

    @Column(name = "window_index", nullable = false)
    private int windowIndex;

    @Column(name = "window_start_seconds", nullable = false)
    private int windowStartSeconds;

    @Column(nullable = false, columnDefinition = "jsonb")
    @ColumnTransformer(write = "?::jsonb")
    private String data;

    protected TelemetryWindow() {}

    public TelemetryWindow(Long flightId, int windowIndex, int windowStartSeconds, String data) {
        this.flightId = flightId;
        this.windowIndex = windowIndex;
        this.windowStartSeconds = windowStartSeconds;
        this.data = data;
    }

    public Long getId() { return id; }
    public Long getFlightId() { return flightId; }
    public int getWindowIndex() { return windowIndex; }
    public int getWindowStartSeconds() { return windowStartSeconds; }
    public String getData() { return data; }
}
