package ai.flightops.backend.user;

/** The authenticated, still-enabled user behind a request. */
public record CurrentUser(long id, String username, Role role) {

    public boolean isAdmin() {
        return role == Role.ADMIN;
    }

    /** Owner or admin may access a resource. */
    public boolean canAccess(long ownerId) {
        return isAdmin() || ownerId == id;
    }
}
