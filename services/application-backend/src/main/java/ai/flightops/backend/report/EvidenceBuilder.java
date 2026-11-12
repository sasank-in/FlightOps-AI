package ai.flightops.backend.report;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import ai.flightops.backend.analysis.AnalysisRun;
import ai.flightops.backend.analysis.AnomalyEvent;
import ai.flightops.backend.config.AppProperties;
import ai.flightops.backend.flight.Flight;
import ai.flightops.backend.flight.TelemetrySchema;

import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Builds the evidence package for a report (documentation.md §16 "Grounding requirements"): verified,
 * structured analysis results only, never raw telemetry. Every item carries a {@code ref} that
 * statements must cite: {@code RUN}, {@code EVAL}, {@code I<n>} (intervals), {@code W<index>}
 * (windows) and {@code V<n>} (variables). Selection is deterministic.
 */
@Component
public class EvidenceBuilder {

    public static final String SCHEMA = "flightops.report-evidence/1";
    static final String DISCLAIMER =
            "Experimental statistical anomaly relative to nominal training approaches; engineering review required. "
            + "Not a confirmed fault or a safety determination.";

    private static final int MIN_CONTEXT_WINDOWS = 3;
    private static final int MAX_VARIABLES = 8;
    private static final int MAX_FEATURES_PER_WINDOW = 3;

    private final JsonMapper json;
    private final int maxWindows;

    public EvidenceBuilder(JsonMapper json, AppProperties props) {
        this.json = json;
        this.maxWindows = Math.max(1, props.reports().maxEvidenceWindows());
    }

    /** The package plus the set of refs a statement may cite. */
    public record Evidence(ObjectNode root, Set<String> refs) {}

    private record Scored(AnomalyEvent event, JsonNode evidence) {}

    /**
     * @param modelCard {@code GET /v1/model} of the inference API, or null when it was unavailable
     */
    public Evidence build(Flight flight, AnalysisRun run, List<AnomalyEvent> events, JsonNode modelCard) {
        Set<String> refs = new LinkedHashSet<>();
        List<Scored> all = events.stream()
                .sorted(Comparator.comparingInt(AnomalyEvent::getWindowIndex))
                .map(e -> new Scored(e, json.readTree(e.getEvidenceJson())))
                .toList();
        List<Scored> above = all.stream().filter(s -> s.event().isAnomaly()).toList();

        ObjectNode root = json.createObjectNode();
        root.put("schema", SCHEMA);

        ObjectNode f = root.putObject("flight");
        f.put("flight_id", flight.getId());
        f.put("external_flight_reference", flight.getExternalFlightReference());
        f.put("n_windows", flight.getNWindows());
        f.put("window_length_seconds", TelemetrySchema.TIMESTEPS);
        f.put("sampling_hz", 1);

        ObjectNode a = root.putObject("analysis");
        a.put("ref", "RUN");
        refs.add("RUN");
        a.put("analysis_id", run.getId());
        a.put("model_name", run.getModelName());
        a.put("model_version", run.getModelVersion());
        putNumber(a, "threshold", run.getThreshold());
        a.put("n_windows_scored", all.size());
        a.put("n_windows_above_threshold", above.size());
        a.put("percent_windows_above_threshold", all.isEmpty() ? 0.0 : round(100.0 * above.size() / all.size(), 1));
        all.stream().mapToDouble(s -> s.event().getScore()).max().ifPresent(v -> a.put("max_score", round(v, 4)));
        all.stream().mapToDouble(s -> s.event().getScore()).average().ifPresent(v -> a.put("mean_score", round(v, 4)));
        if (run.getCompletedAt() != null) {
            a.put("completed_at", run.getCompletedAt().toString());
        }

        ObjectNode d = root.putObject("definitions");
        d.put("anomaly_score", modelCard != null && modelCard.hasNonNull("score_direction")
                ? modelCard.get("score_direction").asString() : "higher = more anomalous");
        d.put("threshold", "Windows scoring at or above the threshold are reported as ABOVE_THRESHOLD. The label is a "
                + "statistical position relative to the threshold, not a safety severity.");
        d.put("score_components", "forest_percentile and tail_percentile: where the window ranks among nominal "
                + "calibration windows for each detector (0-1); the score is the larger of the two.");
        d.put("supporting_features", "The window features furthest from nominal training statistics (z-score vs "
                + "nominal training; tail probability = share of nominal windows at least as extreme). They describe "
                + "what was unusual, not why.");
        d.put("quality_flags", "Data-quality checks on the recorded signals (for example invalid pressure). A raised "
                + "flag can increase a score without any aircraft event.");
        d.put("times", "Seconds from the start of the uploaded flight; each window covers 160 seconds at 1 Hz.");

        ObjectNode ev = root.putObject("evaluation");
        ev.put("ref", "EVAL");
        refs.add("EVAL");
        JsonNode card = modelCard == null ? null : modelCard.get("evaluation");
        ev.put("available", card != null && card.isObject());
        if (card != null && card.isObject()) {
            for (String k : List.of("threshold_policy", "test_precision", "test_recall", "test_pr_auc",
                    "aircraft_held_out_pr_auc_mean", "report_created_at")) {
                JsonNode v = card.get(k);
                if (v != null && v.isNumber()) {
                    ev.put(k, round(v.doubleValue(), 4));
                } else if (v != null && v.isString()) {
                    ev.put(k, v.asString());
                }
            }
        }

        // Contiguous above-threshold windows as intervals
        ArrayNode intervals = root.putArray("intervals");
        int n = 0;
        for (int i = 0; i < all.size(); ) {
            if (!all.get(i).event().isAnomaly()) {
                i++;
                continue;
            }
            int j = i;
            while (j + 1 < all.size() && all.get(j + 1).event().isAnomaly()
                    && all.get(j + 1).event().getWindowIndex() == all.get(j).event().getWindowIndex() + 1) {
                j++;
            }
            ObjectNode it = intervals.addObject();
            String ref = "I" + (++n);
            refs.add(ref);
            it.put("ref", ref);
            it.put("first_window", all.get(i).event().getWindowIndex());
            it.put("last_window", all.get(j).event().getWindowIndex());
            it.put("start_seconds", all.get(i).event().getStartOffset());
            it.put("end_seconds", all.get(j).event().getEndOffset());
            it.put("n_windows", j - i + 1);
            double max = all.subList(i, j + 1).stream().mapToDouble(s -> s.event().getScore()).max().orElse(0);
            it.put("max_score", round(max, 4));
            i = j + 1;
        }

        // Windows: highest-scoring above-threshold windows, topped up with the highest below-threshold ones
        List<Scored> byScore = all.stream()
                .sorted(Comparator.comparingDouble((Scored s) -> s.event().getScore()).reversed()
                        .thenComparingInt(s -> s.event().getWindowIndex()))
                .toList();
        List<Scored> chosen = new ArrayList<>(byScore.stream().filter(s -> s.event().isAnomaly()).limit(maxWindows).toList());
        for (Scored s : byScore) {
            if (chosen.size() >= Math.min(maxWindows, MIN_CONTEXT_WINDOWS)) {
                break;
            }
            if (!s.event().isAnomaly()) {
                chosen.add(s);
            }
        }
        ArrayNode windows = root.putArray("windows");
        for (Scored s : chosen) {
            AnomalyEvent e = s.event();
            ObjectNode w = windows.addObject();
            String ref = "W" + e.getWindowIndex();
            refs.add(ref);
            w.put("ref", ref);
            w.put("window_index", e.getWindowIndex());
            w.put("start_seconds", e.getStartOffset());
            w.put("end_seconds", e.getEndOffset());
            w.put("anomaly_score", round(e.getScore(), 4));
            w.put("threshold", round(e.getThreshold(), 4));
            w.put("above_threshold", e.isAnomaly());
            JsonNode comps = s.evidence().get("score_components");
            if (comps != null && comps.isObject()) {
                ObjectNode c = w.putObject("score_components");
                comps.properties().forEach(p -> {
                    if (p.getValue().isNumber()) {
                        c.put(p.getKey(), round(p.getValue().doubleValue(), 4));
                    }
                });
            }
            ArrayNode feats = w.putArray("supporting_features");
            JsonNode sf = s.evidence().get("supporting_features");
            if (sf != null && sf.isArray()) {
                int k = 0;
                for (JsonNode x : sf) {
                    if (k++ >= MAX_FEATURES_PER_WINDOW) {
                        break;
                    }
                    ObjectNode o = feats.addObject();
                    copyString(x, o, "feature");
                    copyString(x, o, "statistic");
                    copyNumber(x, o, "observed_value", 4);
                    copyString(x, o, "unit");
                    copyNumber(x, o, "z_score_vs_nominal_training", 2);
                    copyNumber(x, o, "tail_probability_vs_nominal", 4);
                }
            }
            ArrayNode flags = w.putArray("quality_flags_raised");
            raisedFlags(s.evidence()).forEach(flags::add);
        }

        // Variables most often among the supporting features of above-threshold windows (all of them, not only those listed)
        Map<String, List<Integer>> appearances = new LinkedHashMap<>();
        for (Scored s : above) {
            JsonNode sf = s.evidence().get("supporting_features");
            if (sf == null || !sf.isArray()) {
                continue;
            }
            Set<String> seen = new LinkedHashSet<>();
            int k = 0;
            for (JsonNode x : sf) {
                if (k++ >= MAX_FEATURES_PER_WINDOW) {
                    break;
                }
                if (x.hasNonNull("feature") && seen.add(x.get("feature").asString())) {
                    appearances.computeIfAbsent(x.get("feature").asString(), key -> new ArrayList<>())
                            .add(s.event().getWindowIndex());
                }
            }
        }
        Set<String> listedWindows = new LinkedHashSet<>(refs);
        ArrayNode variables = root.putArray("variables");
        int v = 0;
        for (var entry : appearances.entrySet().stream()
                .sorted(Comparator.comparingInt((Map.Entry<String, List<Integer>> e) -> e.getValue().size()).reversed()
                        .thenComparing(Map.Entry::getKey))
                .limit(MAX_VARIABLES).toList()) {
            ObjectNode o = variables.addObject();
            String ref = "V" + (++v);
            refs.add(ref);
            o.put("ref", ref);
            o.put("feature", entry.getKey());
            o.put("n_above_threshold_windows", entry.getValue().size());
            ArrayNode in = o.putArray("window_refs");
            entry.getValue().stream().map(i -> "W" + i).filter(listedWindows::contains).forEach(in::add);
        }

        // Data-quality flags raised anywhere in the flight
        Map<String, Integer> flagCounts = new LinkedHashMap<>();
        for (Scored s : all) {
            raisedFlags(s.evidence()).forEach(name -> flagCounts.merge(name, 1, Integer::sum));
        }
        ObjectNode q = root.putObject("quality_flags");
        flagCounts.forEach(q::put);

        ObjectNode omitted = root.putObject("omitted");
        omitted.put("windows_not_listed", all.size() - chosen.size());
        omitted.put("above_threshold_windows_not_listed", above.size() - chosen.stream().filter(s -> s.event().isAnomaly()).count());
        omitted.put("raw_telemetry", "not included");

        ArrayNode lim = root.putArray("limitations");
        limitations(root).forEach(lim::add);
        return new Evidence(root, refs);
    }

    /** Fixed, evidence-derived limitations. Written by the system, never by the language model. */
    static List<String> limitations(JsonNode root) {
        List<String> out = new ArrayList<>();
        out.add(DISCLAIMER);
        out.add("Scores rank each window against nominal training approaches from the NASA DASHlink dataset; flights "
                + "unlike that data (aircraft type, airport, procedure) can score high without anything unusual "
                + "happening.");
        JsonNode ev = root.path("evaluation");
        if (ev.path("available").asBoolean(false) && ev.has("test_pr_auc")) {
            StringBuilder s = new StringBuilder("Measured detection performance is limited: on the held-out test split "
                    + "the model reached PR-AUC " + ev.get("test_pr_auc").asString());
            if (ev.has("test_precision") && ev.has("test_recall")) {
                s.append(" (precision ").append(ev.get("test_precision").asString()).append(", recall ")
                        .append(ev.get("test_recall").asString()).append(" at the served threshold)");
            }
            if (ev.has("aircraft_held_out_pr_auc_mean")) {
                s.append("; on aircraft not seen in training, mean PR-AUC ").append(ev.get("aircraft_held_out_pr_auc_mean").asString());
            }
            out.add(s.append(". Expect both missed events and false alerts.").toString());
        } else {
            out.add("Model evaluation figures were unavailable when this report was generated.");
        }
        out.add("Supporting features show which window statistics were furthest from nominal; they are not causes.");
        if (!root.path("quality_flags").isEmpty()) {
            out.add("Data-quality flags were raised in this flight; affected windows may score high because of the "
                    + "recording rather than the aircraft.");
        }
        long notListed = root.path("omitted").path("above_threshold_windows_not_listed").asLong(0);
        if (notListed > 0) {
            out.add(notListed + " further above-threshold window(s) are not itemised in this report; see the analysis "
                    + "timeline for all windows.");
        }
        return out;
    }

    private static List<String> raisedFlags(JsonNode evidence) {
        List<String> out = new ArrayList<>();
        JsonNode qf = evidence.get("quality_flags");
        if (qf != null && qf.isObject()) {
            qf.properties().forEach(p -> {
                JsonNode val = p.getValue();
                if ((val.isBoolean() && val.asBoolean()) || (val.isNumber() && val.doubleValue() != 0)) {
                    out.add(p.getKey());
                }
            });
        }
        return out;
    }

    private static void copyString(JsonNode from, ObjectNode to, String key) {
        JsonNode v = from.get(key);
        if (v != null && v.isString()) {
            to.put(key, v.asString());
        }
    }

    private static void copyNumber(JsonNode from, ObjectNode to, String key, int decimals) {
        JsonNode v = from.get(key);
        if (v != null && v.isNumber() && Double.isFinite(v.doubleValue())) {
            to.put(key, round(v.doubleValue(), decimals));
        }
    }

    private static void putNumber(ObjectNode to, String key, Double value) {
        if (value != null && Double.isFinite(value)) {
            to.put(key, round(value, 4));
        }
    }

    static double round(double v, int decimals) {
        return java.math.BigDecimal.valueOf(v).setScale(decimals, java.math.RoundingMode.HALF_UP).doubleValue();
    }
}
