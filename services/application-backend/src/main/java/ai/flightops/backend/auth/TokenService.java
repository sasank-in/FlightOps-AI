package ai.flightops.backend.auth;

import java.time.Instant;
import java.util.List;

import ai.flightops.backend.config.AppProperties;
import ai.flightops.backend.config.SecurityConfig;
import ai.flightops.backend.user.UserAccount;

import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.stereotype.Service;

@Service
public class TokenService {

    private final JwtEncoder encoder;
    private final AppProperties props;

    public TokenService(JwtEncoder encoder, AppProperties props) {
        this.encoder = encoder;
        this.props = props;
    }

    public record IssuedToken(String value, long expiresInSeconds) {}

    public IssuedToken issue(UserAccount user) {
        Instant now = Instant.now();
        long ttl = props.security().tokenTtl().toSeconds();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(SecurityConfig.ISSUER)
                .subject(user.getUsername())
                .issuedAt(now)
                .expiresAt(now.plusSeconds(ttl))
                .claim("roles", List.of(user.getRole().name()))
                .build();
        JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
        return new IssuedToken(encoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue(), ttl);
    }
}
