package ai.flightops.backend.config;

import javax.sql.DataSource;

import com.zaxxer.hikari.HikariDataSource;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** DataSource built from DATABASE_URL (repo-root .env), so the JDBC password never lives in config files. */
@Configuration(proxyBeanMethods = false)
public class DatabaseConfig {

    @Bean
    DataSource dataSource(AppProperties props) {
        DatabaseUrl db = DatabaseUrl.parse(props.database().url(), props.database().nameOverride());
        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl(db.jdbcUrl());
        ds.setUsername(db.username());
        ds.setPassword(db.password());
        ds.setMaximumPoolSize(10);
        ds.setPoolName("flightops");
        return ds;
    }
}
