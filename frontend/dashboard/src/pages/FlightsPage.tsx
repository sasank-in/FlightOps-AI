import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { endpoints } from "../api/endpoints";
import type { LatestAnalysis, UploadBody } from "../api/types";
import { IconAlert, IconDownload, IconSearch, IconUpload } from "../components/Icons";
import { useToast } from "../components/toast";
import { Card, Dialog, Empty, ErrorBanner, InfoBanner, Loading, Pager, StatusBadge } from "../components/ui";
import { formatClock, formatDateTime } from "../lib/format";
import { MAX_WINDOWS, TIMESTEPS, uploadTemplate, validateUpload } from "../lib/telemetry";

const PAGE_SIZE = 20;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_QUERY = 128;   // backend limit for ?q=

export function FlightsPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(0, Number(params.get("page") ?? 0) || 0);
  const uploadOpen = params.get("upload") === "1";
  const navigate = useNavigate();

  const q = (params.get("q") ?? "").trim().slice(0, MAX_QUERY);
  const [draft, setDraft] = useState(q);

  // Keep the box in sync when the URL changes (back/forward), and debounce typing into the URL.
  useEffect(() => { setDraft((d) => (d.trim() === q ? d : q)); }, [q]);
  useEffect(() => {
    const next = draft.trim();
    if (next === q) return;
    const t = window.setTimeout(() => setParams((prev) => {
      if (next) prev.set("q", next); else prev.delete("q");
      prev.delete("page");
      return prev;
    }, { replace: true }), 300);
    return () => window.clearTimeout(t);
  }, [draft, q, setParams]);

  const flights = useQuery({
    queryKey: ["flights", page, q],
    queryFn: () => endpoints.flights(page, PAGE_SIZE, q),
    placeholderData: keepPreviousData,
  });

  const setPage = (p: number) => setParams((prev) => { prev.set("page", String(p)); return prev; });
  const setUpload = (open: boolean) => setParams((prev) => {
    if (open) prev.set("upload", "1"); else prev.delete("upload");
    return prev;
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Flights</h1>
          <p>Uploaded flights, each made of 160-second telemetry windows sampled at 1 Hz.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setUpload(true)}><IconUpload size={16} />Upload flight</button>
        </div>
      </div>

      <Card flush>
        {(q || draft || (flights.data && flights.data.totalItems > 0)) && (
          <div className="list-toolbar">
            <div className="search">
              <IconSearch size={16} />
              <input className="input" type="search" placeholder="Search flight reference" aria-label="Search flight reference"
                value={draft} maxLength={MAX_QUERY} onChange={(e) => setDraft(e.target.value)} />
            </div>
            {flights.data && (
              <span className="hint" aria-live="polite">
                {q ? `${flights.data.totalItems} match${flights.data.totalItems === 1 ? "" : "es"}` : `${flights.data.totalItems} flight${flights.data.totalItems === 1 ? "" : "s"}`}
              </span>
            )}
          </div>
        )}
        {flights.isPending && <Loading />}
        {flights.isError && <div className="card-body"><ErrorBanner error={flights.error} /></div>}
        {flights.data && flights.data.items.length === 0 && q && (
          <Empty title="No matching flights" icon={<IconSearch size={20} />}
            action={<button className="btn" onClick={() => setDraft("")}>Clear search</button>}>
            No flight reference contains “{q}”.
          </Empty>
        )}
        {flights.data && flights.data.items.length === 0 && !q && (
          <Empty title="No flights yet" icon={<IconUpload size={20} />}
            action={<button className="btn btn-primary" onClick={() => setUpload(true)}><IconUpload size={16} />Upload a flight</button>}>
            Upload approach telemetry as JSON (160-second windows of 20 signals) to start analysing.
          </Empty>
        )}
        {flights.data && flights.data.items.length > 0 && (
          <div className={flights.isPlaceholderData ? "refetching" : undefined}>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th style={{ width: 72 }}>ID</th><th>Flight reference</th><th>Dataset</th><th className="right">Windows</th><th className="right">Duration</th><th>Latest analysis</th><th className="right">Above threshold</th><th>Uploaded</th></tr>
                </thead>
                <tbody>
                  {flights.data.items.map((f) => (
                    <tr key={f.id} className="clickable" onClick={() => navigate(`/flights/${f.id}`)}>
                      <td className="num muted">#{f.id}</td>
                      <td><Link to={`/flights/${f.id}`} onClick={(e) => e.stopPropagation()} style={{ fontWeight: 500 }}>{f.externalFlightReference}</Link></td>
                      <td className="secondary">{f.datasetId ?? "—"}</td>
                      <td className="right">{f.nWindows}</td>
                      <td className="right">{formatClock(f.nWindows * TIMESTEPS)}</td>
                      <td>{f.latestAnalysis ? <StatusBadge status={f.latestAnalysis.status} /> : <span className="muted">Not analysed</span>}</td>
                      <td className="right"><AlertCount analysis={f.latestAnalysis} /></td>
                      <td className="secondary">{formatDateTime(f.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={flights.data.page} totalPages={flights.data.totalPages} totalItems={flights.data.totalItems} onPage={setPage} />
          </div>
        )}
      </Card>

      {uploadOpen && <UploadDialog onClose={() => setUpload(false)} onUploaded={(id) => navigate(`/flights/${id}`)} />}
    </>
  );
}

/** "n / m" windows above threshold for a completed run; a critical badge when any window is flagged. */
function AlertCount({ analysis }: { analysis?: LatestAnalysis | null }) {
  if (!analysis || analysis.status !== "COMPLETED" || analysis.nAboveThreshold == null || analysis.nWindows == null) {
    return <span className="muted">—</span>;
  }
  const label = `${analysis.nAboveThreshold} / ${analysis.nWindows}`;
  return analysis.nAboveThreshold > 0
    ? <span className="badge badge-critical" title={`${label} windows above threshold`}><IconAlert size={13} />{label}</span>
    : <span className="secondary" title={`${label} windows above threshold`}>{label}</span>;
}

function UploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: (id: number) => void }) {
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState<string | null>(null);
  const [body, setBody] = useState<UploadBody | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const toast = useToast();
  const upload = useMutation({
    mutationFn: endpoints.upload,
    onSuccess: (flight) => {
      toast(`Flight ${flight.externalFlightReference} uploaded (${flight.nWindows} windows)`);
      void queryClient.invalidateQueries({ queryKey: ["flights"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      onUploaded(flight.id);
    },
  });

  function downloadTemplate() {
    const blob = new Blob([JSON.stringify(uploadTemplate(), null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flightops-upload-template.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setBody(null);
    setProblems([]);
    upload.reset();
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setProblems([`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`]);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setProblems(["The file is not valid JSON."]);
      return;
    }
    const result = validateUpload(parsed);
    if (result.ok && result.body) setBody(result.body);
    else setProblems(result.errors);
  }

  return (
    <Dialog title="Upload flight" onClose={onClose} footer={
      <>
        <button className="btn btn-ghost" style={{ marginRight: "auto" }} onClick={downloadTemplate}>
          <IconDownload size={16} />Download template
        </button>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!body || upload.isPending} onClick={() => body && upload.mutate(body)}>
          {upload.isPending ? "Uploading…" : "Upload"}
        </button>
      </>
    }>
      <div className="stack">
        <p className="secondary">
          Select a JSON file with <span className="mono">externalFlightReference</span> and up to {MAX_WINDOWS}
          {" "}<span className="mono">windows</span>, each holding all 20 telemetry variables with {TIMESTEPS} values.
        </p>
        <label className="dropzone">
          <input type="file" accept="application/json,.json" onChange={onFile} className="sr-only" />
          <IconUpload size={20} />
          <div style={{ marginTop: 6, fontWeight: 500 }}>{fileName ?? "Choose a JSON file"}</div>
          <div className="hint">The file is checked in your browser before anything is sent.</div>
        </label>
        {problems.length > 0 && (
          <div className="banner banner-error" role="alert">
            <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {body && (
          <InfoBanner>
            Ready to upload <strong>{body.externalFlightReference}</strong>: {body.windows.length} window
            {body.windows.length === 1 ? "" : "s"} ({formatClock(body.windows.length * TIMESTEPS)} of telemetry).
          </InfoBanner>
        )}
        <ErrorBanner error={upload.error} />
      </div>
    </Dialog>
  );
}
