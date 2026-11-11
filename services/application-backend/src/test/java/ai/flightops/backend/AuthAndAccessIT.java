package ai.flightops.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import org.junit.jupiter.api.Test;

class AuthAndAccessIT extends IntegrationTestBase {

    @Test
    void healthIsPublicButApiRequiresToken() {
        assertThat(send("GET", "/actuator/health", null, null).status()).isEqualTo(200);
        assertThat(send("GET", "/api/v1/flights", null, null).status()).isEqualTo(401);
        assertThat(send("GET", "/api/v1/flights", "not-a-jwt", null).status()).isEqualTo(401);
        assertThat(send("GET", "/some/unknown/path", adminToken(), null).status()).isIn(403, 404);
    }

    @Test
    void loginReturnsBearerTokenAndRejectsBadCredentialsUniformly() {
        Resp ok = send("POST", "/api/v1/auth/login", null, Map.of("username", "admin", "password", ADMIN_PASSWORD));
        assertThat(ok.status()).isEqualTo(200);
        assertThat(ok.body().get("token_type").asString()).isEqualTo("Bearer");
        assertThat(ok.body().get("expires_in").asLong()).isEqualTo(3600);

        Resp wrongPassword = send("POST", "/api/v1/auth/login", null, Map.of("username", "admin", "password", "wrong-password-xyz"));
        Resp unknownUser = send("POST", "/api/v1/auth/login", null, Map.of("username", "nobody-here", "password", "wrong-password-xyz"));
        assertThat(wrongPassword.status()).isEqualTo(401);
        assertThat(unknownUser.status()).isEqualTo(401);
        assertThat(wrongPassword.body().get("detail").asString()).isEqualTo(unknownUser.body().get("detail").asString());
        assertThat(wrongPassword.raw().body()).doesNotContain("wrong-password-xyz");
    }

    @Test
    void repeatedFailuresLockTheAccount() {
        createUser(adminToken(), "lockme", "ANALYST");
        for (int i = 0; i < 3; i++) {
            assertThat(send("POST", "/api/v1/auth/login", null, Map.of("username", "lockme", "password", "bad-password-1")).status())
                    .isEqualTo(401);
        }
        Resp locked = send("POST", "/api/v1/auth/login", null, Map.of("username", "lockme", "password", "analyst-password-123"));
        assertThat(locked.status()).isEqualTo(429);   // even the right password is refused during lockout
    }

    @Test
    void adminManagesUsersAndAnalystsCannot() {
        String admin = adminToken();
        String analyst = createUser(admin, "alice", "ANALYST");

        assertThat(send("GET", "/api/v1/users", analyst, null).status()).isEqualTo(403);
        assertThat(send("GET", "/api/v1/audit", analyst, null).status()).isEqualTo(403);
        assertThat(send("POST", "/api/v1/users", admin,
                Map.of("username", "alice", "password", "another-password-1", "role", "ANALYST")).status()).isEqualTo(409);
        Resp weak = send("POST", "/api/v1/users", admin, Map.of("username", "bob", "password", "short", "role", "ANALYST"));
        assertThat(weak.status()).isEqualTo(400);
        assertThat(weak.raw().body()).doesNotContain("short\"");
        assertThat(send("GET", "/api/v1/users", admin, null).body().size()).isEqualTo(2);
    }

    @Test
    void disablingAUserRevokesAccessImmediately() {
        String admin = adminToken();
        String analyst = createUser(admin, "carol", "ANALYST");
        assertThat(send("GET", "/api/v1/flights", analyst, null).status()).isEqualTo(200);

        long id = send("GET", "/api/v1/users", admin, null).body().valueStream()
                .filter(u -> u.get("username").asString().equals("carol")).findFirst().orElseThrow().get("id").asLong();
        assertThat(send("PATCH", "/api/v1/users/" + id, admin, Map.of("enabled", false)).status()).isEqualTo(200);

        assertThat(send("GET", "/api/v1/flights", analyst, null).status()).isEqualTo(401);   // same token, now refused
        assertThat(send("POST", "/api/v1/auth/login", null, Map.of("username", "carol", "password", "analyst-password-123")).status())
                .isEqualTo(401);
    }

    @Test
    void auditTrailRecordsLoginsAndUserChanges() {
        String admin = adminToken();
        createUser(admin, "dave", "ANALYST");
        var actions = send("GET", "/api/v1/audit?limit=50", admin, null).body().valueStream()
                .map(e -> e.get("action").asString() + ":" + e.get("outcome").asString()).toList();
        assertThat(actions).contains("LOGIN:SUCCESS", "USER_CREATE:SUCCESS");
        assertThat(jdbc.queryForObject("select count(*) from audit_events where detail like '%password%'", Long.class)).isZero();
    }
}
