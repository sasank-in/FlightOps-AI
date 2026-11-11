package ai.flightops.backend.common;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import ai.flightops.backend.config.AppProperties;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Rejects request bodies larger than flightops.upload.max-body-bytes before they are read. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestSizeLimitFilter extends OncePerRequestFilter {

    private final long maxBytes;

    public RequestSizeLimitFilter(AppProperties props) {
        this.maxBytes = props.upload().maxBodyBytes();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long length = request.getContentLengthLong();
        boolean chunked = length < 0 && "chunked".equalsIgnoreCase(request.getHeader("Transfer-Encoding"));
        if (length > maxBytes || chunked) {
            response.setStatus(chunked ? HttpServletResponse.SC_LENGTH_REQUIRED : HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            String detail = chunked ? "Content-Length is required" : "Request body exceeds " + maxBytes + " bytes";
            response.getWriter().write("{\"title\":\"Request rejected\",\"status\":" + response.getStatus()
                    + ",\"detail\":\"" + detail + "\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
