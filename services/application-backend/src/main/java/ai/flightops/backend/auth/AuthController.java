package ai.flightops.backend.auth;

import java.util.Optional;

import com.fasterxml.jackson.annotation.JsonProperty;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import ai.flightops.backend.audit.AuditEvent.Outcome;
import ai.flightops.backend.audit.AuditService;
import ai.flightops.backend.common.ApiException;
import ai.flightops.backend.user.UserAccount;
import ai.flightops.backend.user.UserRepository;

import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    public record LoginRequest(@NotBlank @Size(max = 64) String username, @NotBlank @Size(max = 200) String password) {}

    public record TokenResponse(@JsonProperty("access_token") String accessToken,
                                @JsonProperty("token_type") String tokenType,
                                @JsonProperty("expires_in") long expiresIn) {}

    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final TokenService tokens;
    private final LoginAttemptLimiter limiter;
    private final AuditService audit;
    /** Compared against when the user does not exist, so response time does not reveal valid usernames. */
    private final String dummyHash;

    public AuthController(UserRepository users, PasswordEncoder passwords, TokenService tokens,
                          LoginAttemptLimiter limiter, AuditService audit) {
        this.users = users;
        this.passwords = passwords;
        this.tokens = tokens;
        this.limiter = limiter;
        this.audit = audit;
        this.dummyHash = passwords.encode("timing-equaliser-" + System.nanoTime());
    }

    @PostMapping("/login")
    public TokenResponse login(@Valid @RequestBody LoginRequest req) {
        String username = req.username().trim();
        if (limiter.isLocked(username)) {
            audit.record(username, "LOGIN", "user", null, Outcome.DENIED, "locked out after repeated failures");
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "Too many failed attempts; try again later");
        }
        Optional<UserAccount> user = users.findByUsername(username);
        boolean ok = passwords.matches(req.password(), user.map(UserAccount::getPasswordHash).orElse(dummyHash))
                && user.isPresent() && user.get().isEnabled();
        if (!ok) {
            limiter.recordFailure(username);
            audit.record(username, "LOGIN", "user", null, Outcome.FAILURE, "invalid credentials");
            throw ApiException.unauthorized("Invalid username or password");   // same message for every cause
        }
        limiter.recordSuccess(username);
        audit.record(username, "LOGIN", "user", user.get().getId(), Outcome.SUCCESS, null);
        TokenService.IssuedToken t = tokens.issue(user.get());
        return new TokenResponse(t.value(), "Bearer", t.expiresInSeconds());
    }
}
