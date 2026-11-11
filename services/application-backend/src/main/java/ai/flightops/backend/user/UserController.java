package ai.flightops.backend.user;

import java.net.URI;
import java.time.Instant;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import ai.flightops.backend.audit.AuditEvent.Outcome;
import ai.flightops.backend.audit.AuditService;
import ai.flightops.backend.common.ApiException;

import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** User management (ADMIN only; enforced in SecurityConfig). */
@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    public static final int MIN_PASSWORD_LENGTH = 12;

    public record CreateUserRequest(
            @NotBlank @Pattern(regexp = "^[A-Za-z0-9._-]{3,64}$", message = "3-64 letters, digits, '.', '_' or '-'") String username,
            @NotBlank @Size(min = MIN_PASSWORD_LENGTH, max = 200) String password,
            @NotNull Role role) {}

    public record UpdateUserRequest(@NotNull Boolean enabled) {}

    public record UserResponse(long id, String username, Role role, boolean enabled, Instant createdAt) {
        static UserResponse of(UserAccount u) {
            return new UserResponse(u.getId(), u.getUsername(), u.getRole(), u.isEnabled(), u.getCreatedAt());
        }
    }

    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final UserContext userContext;
    private final AuditService audit;

    public UserController(UserRepository users, PasswordEncoder passwords, UserContext userContext, AuditService audit) {
        this.users = users;
        this.passwords = passwords;
        this.userContext = userContext;
        this.audit = audit;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<UserResponse> list(@AuthenticationPrincipal Jwt jwt) {
        userContext.resolve(jwt);
        return users.findAll(Sort.by("id")).stream().map(UserResponse::of).toList();
    }

    @PostMapping
    @Transactional
    public ResponseEntity<UserResponse> create(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody CreateUserRequest req) {
        CurrentUser admin = userContext.resolve(jwt);
        if (users.existsByUsername(req.username())) {
            audit.record(admin.username(), "USER_CREATE", "user", null, Outcome.FAILURE, "username already exists");
            throw ApiException.conflict("Username already exists");
        }
        UserAccount saved = users.save(new UserAccount(req.username(), passwords.encode(req.password()), req.role()));
        audit.record(admin.username(), "USER_CREATE", "user", saved.getId(), Outcome.SUCCESS, "role=" + saved.getRole());
        return ResponseEntity.created(URI.create("/api/v1/users/" + saved.getId())).body(UserResponse.of(saved));
    }

    @PatchMapping("/{id}")
    @Transactional
    public UserResponse update(@AuthenticationPrincipal Jwt jwt, @PathVariable long id, @Valid @RequestBody UpdateUserRequest req) {
        CurrentUser admin = userContext.resolve(jwt);
        UserAccount user = users.findById(id).orElseThrow(() -> ApiException.notFound("User"));
        if (user.getId() == admin.id() && !req.enabled()) {
            throw ApiException.badRequest("Administrators cannot disable their own account");
        }
        user.setEnabled(req.enabled());
        audit.record(admin.username(), req.enabled() ? "USER_ENABLE" : "USER_DISABLE", "user", id, Outcome.SUCCESS, null);
        return UserResponse.of(user);
    }
}
