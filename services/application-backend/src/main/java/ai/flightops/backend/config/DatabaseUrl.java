package ai.flightops.backend.config;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * Parses a libpq-style {@code postgresql://user:password@host:port/database} URL (the
 * {@code DATABASE_URL} in .env) into JDBC settings. Error messages never include the password.
 */
public record DatabaseUrl(String jdbcUrl, String username, String password, String database) {

    public static DatabaseUrl parse(String url, String databaseOverride) {
        if (url == null || url.isBlank()) {
            throw new IllegalStateException(
                    "DATABASE_URL is not set. Add DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB to the repo-root .env");
        }
        URI uri;
        try {
            uri = new URI(url.trim());
        } catch (URISyntaxException e) {
            throw new IllegalStateException("DATABASE_URL is not a valid URL (expected postgresql://user:password@host:port/db)");
        }
        String scheme = uri.getScheme();
        if (!"postgresql".equals(scheme) && !"postgres".equals(scheme)) {
            throw new IllegalStateException("DATABASE_URL must start with postgresql://");
        }
        String userInfo = uri.getRawUserInfo();
        if (userInfo == null || !userInfo.contains(":")) {
            throw new IllegalStateException("DATABASE_URL must include user and password (postgresql://user:password@host/db)");
        }
        int sep = userInfo.indexOf(':');
        String user = decode(userInfo.substring(0, sep));
        String password = decode(userInfo.substring(sep + 1));
        String host = uri.getHost();
        if (host == null) {
            throw new IllegalStateException("DATABASE_URL has no host");
        }
        int port = uri.getPort() > 0 ? uri.getPort() : 5432;
        String path = uri.getPath() == null ? "" : uri.getPath().replaceFirst("^/", "");
        String database = (databaseOverride != null && !databaseOverride.isBlank()) ? databaseOverride.trim() : path;
        if (database.isBlank()) {
            throw new IllegalStateException("DATABASE_URL has no database name");
        }
        if (!database.matches("[A-Za-z0-9_\\-]{1,63}")) {
            throw new IllegalStateException("Database name contains unsupported characters");
        }
        return new DatabaseUrl("jdbc:postgresql://" + host + ":" + port + "/" + database, user, password, database);
    }

    private static String decode(String s) {
        return URLDecoder.decode(s, StandardCharsets.UTF_8);
    }

    @Override
    public String toString() {   // never print the password
        return "DatabaseUrl[jdbcUrl=" + jdbcUrl + ", username=" + username + ", password=***]";
    }
}
