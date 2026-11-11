package ai.flightops.backend.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;

import org.junit.jupiter.api.Test;
import org.springframework.web.client.ResourceAccessException;

class AnalysisWorkerMessagesTest {

    @Test
    void failureMessagesAreSafeSummaries() {
        assertThat(AnalysisWorker.safeMessage(new ResourceAccessException("Connection refused: 10.0.0.5:8000", new IOException())))
                .isEqualTo("Inference service unavailable or timed out");
        assertThat(AnalysisWorker.safeMessage(new IllegalStateException("Inference response does not match the request (window count)")))
                .contains("does not match");
        assertThat(AnalysisWorker.safeMessage(new NullPointerException("secret internal detail")))
                .isEqualTo("Analysis failed due to an internal error");
    }
}
