package ai.flightops.backend.flight;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import org.hibernate.annotations.ColumnTransformer;

@Entity
@Table(name = "flights")
public class Flight {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "external_flight_reference", nullable = false, length = 128)
    private String externalFlightReference;

    @Column(name = "dataset_id", length = 128)
    private String datasetId;

    @Column(name = "owner_id", nullable = false)
    private Long ownerId;

    @Column(name = "metadata_json", nullable = false, columnDefinition = "jsonb")
    @ColumnTransformer(write = "?::jsonb")
    private String metadataJson;

    @Column(name = "n_windows", nullable = false)
    private int nWindows;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    protected Flight() {}

    public Flight(String externalFlightReference, String datasetId, Long ownerId, String metadataJson, int nWindows) {
        this.externalFlightReference = externalFlightReference;
        this.datasetId = datasetId;
        this.ownerId = ownerId;
        this.metadataJson = metadataJson;
        this.nWindows = nWindows;
    }

    public Long getId() { return id; }
    public String getExternalFlightReference() { return externalFlightReference; }
    public String getDatasetId() { return datasetId; }
    public Long getOwnerId() { return ownerId; }
    public String getMetadataJson() { return metadataJson; }
    public int getNWindows() { return nWindows; }
    public Instant getCreatedAt() { return createdAt; }
}
