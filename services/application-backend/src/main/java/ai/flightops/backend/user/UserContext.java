package ai.flightops.backend.user;

import ai.flightops.backend.common.ApiException;

import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Resolves the user for a request from the token AND the database, so a user who has been
 * disabled or deleted loses access immediately instead of when the token expires.
 */
@Component
public class UserContext {

    private final UserRepository users;

    public UserContext(UserRepository users) {
        this.users = users;
    }

    @Transactional(readOnly = true)
    public CurrentUser resolve(Jwt jwt) {
        if (jwt == null) {
            throw ApiException.unauthorized("Authentication required");
        }
        UserAccount user = users.findByUsername(jwt.getSubject())
                .filter(UserAccount::isEnabled)
                .orElseThrow(() -> ApiException.unauthorized("User is disabled or no longer exists"));
        return new CurrentUser(user.getId(), user.getUsername(), user.getRole());
    }
}
