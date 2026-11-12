package ai.flightops.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** Bounded executor for analysis jobs: a full queue rejects new work instead of growing without limit. */
@Configuration(proxyBeanMethods = false)
@EnableAsync
public class AsyncConfig {

    public static final String ANALYSIS_EXECUTOR = "analysisExecutor";

    @Bean(name = ANALYSIS_EXECUTOR)
    ThreadPoolTaskExecutor analysisExecutor(AppProperties props) {
        ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
        ex.setCorePoolSize(props.analysis().workerThreads());
        ex.setMaxPoolSize(props.analysis().workerThreads());
        ex.setQueueCapacity(props.analysis().queueCapacity());
        ex.setThreadNamePrefix("analysis-");
        ex.setWaitForTasksToCompleteOnShutdown(true);
        ex.setAwaitTerminationSeconds(30);
        ex.initialize();
        return ex;
    }

    public static final String REPORT_EXECUTOR = "reportExecutor";

    /** Separate pool so slow language-model calls never delay analyses. */
    @Bean(name = REPORT_EXECUTOR)
    ThreadPoolTaskExecutor reportExecutor(AppProperties props) {
        ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
        ex.setCorePoolSize(props.reports().workerThreads());
        ex.setMaxPoolSize(props.reports().workerThreads());
        ex.setQueueCapacity(props.reports().queueCapacity());
        ex.setThreadNamePrefix("report-");
        ex.setWaitForTasksToCompleteOnShutdown(true);
        ex.setAwaitTerminationSeconds(30);
        ex.initialize();
        return ex;
    }
}
