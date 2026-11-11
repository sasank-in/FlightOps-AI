package ai.flightops.backend.user;

import ai.flightops.backend.audit.AuditEvent.Outcome;
import ai.flightops.backend.audit.AuditService;
import ai.flightops.backend.config.AppProperties;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Creates the first ADMIN from FLIGHTOPS_ADMIN_USERNAME / FLIGHTOPS_ADMIN_PASSWORD when no users exist. */
@Component
public class AdminBootstrap implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

    private final UserRepository users;
    private final PasswordEncoder passwords;
    private final AppProperties props;
    private final AuditService audit;

    public AdminBootstrap(UserRepository users, PasswordEncoder passwords, AppProperties props, AuditService audit) {
        this.users = users;
        this.passwords = passwords;
        this.props = props;
        this.audit = audit;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (users.count() > 0) {
            return;
        }
        String username = props.bootstrap().adminUsername();
        String password = props.bootstrap().adminPassword();
        if (password == null || password.isBlank()) {
            log.warn("No users exist and FLIGHTOPS_ADMIN_PASSWORD is not set: nobody can log in until it is.");
            return;
        }
        if (password.length() < UserController.MIN_PASSWORD_LENGTH) {
            throw new IllegalStateException("FLIGHTOPS_ADMIN_PASSWORD must be at least "
                    + UserController.MIN_PASSWORD_LENGTH + " characters");
        }
        UserAccount admin = users.save(new UserAccount(username, passwords.encode(password), Role.ADMIN));
        audit.record("system", "USER_CREATE", "user", admin.getId(), Outcome.SUCCESS, "bootstrap admin");
        log.info("Created bootstrap admin user '{}'", username);
    }
}
