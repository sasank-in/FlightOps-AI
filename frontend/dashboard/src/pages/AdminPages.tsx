import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { endpoints } from "../api/endpoints";
import type { Role } from "../api/types";
import { Badge, Card, ErrorBanner, Loading } from "../components/ui";
import { useAuth } from "../lib/auth";
import { formatDateTime } from "../lib/format";

export function UsersPage() {
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: endpoints.users });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("ANALYST");

  const create = useMutation({
    mutationFn: () => endpoints.createUser(username.trim(), password, role),
    onSuccess: () => {
      setUsername("");
      setPassword("");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => endpoints.setUserEnabled(id, enabled),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Users</h1>
          <p>Accounts and roles. Disabling an account revokes its access immediately.</p>
        </div>
      </div>
      <div className="grid grid-main-side">
        <Card title="Accounts" flush>
          {users.isPending && <Loading />}
          {users.isError && <div className="card-body"><ErrorBanner error={users.error} /></div>}
          {users.data && (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th className="right">Action</th></tr></thead>
                <tbody>
                  {users.data.map((u) => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 500 }}>{u.username}{u.id === me?.id && <span className="muted"> (you)</span>}</td>
                      <td>{u.role === "ADMIN" ? <Badge tone="info">Administrator</Badge> : <Badge>Analyst</Badge>}</td>
                      <td>{u.enabled ? <Badge tone="good">Active</Badge> : <Badge tone="critical">Disabled</Badge>}</td>
                      <td className="secondary">{formatDateTime(u.createdAt)}</td>
                      <td className="right">
                        {u.id !== me?.id && (
                          <button className="btn btn-sm" disabled={toggle.isPending}
                            onClick={() => toggle.mutate({ id: u.id, enabled: !u.enabled })}>
                            {u.enabled ? "Disable" : "Enable"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {toggle.error && <div className="card-body"><ErrorBanner error={toggle.error} /></div>}
        </Card>

        <Card title="Create account" subtitle="Passwords need at least 12 characters">
          <form className="stack" onSubmit={submit}>
            <div className="field">
              <label htmlFor="new-username">Username</label>
              <input id="new-username" className="input" value={username} onChange={(e) => setUsername(e.target.value)}
                pattern="[A-Za-z0-9._\-]{3,64}" maxLength={64} autoComplete="off" required />
              <span className="hint">3–64 letters, digits, “.”, “_” or “-”.</span>
            </div>
            <div className="field">
              <label htmlFor="new-password">Initial password</label>
              <input id="new-password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                minLength={12} maxLength={200} autoComplete="new-password" required />
            </div>
            <div className="field">
              <label htmlFor="new-role">Role</label>
              <select id="new-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="ANALYST">Analyst: own flights and analyses</option>
                <option value="ADMIN">Administrator: all flights, users, audit</option>
              </select>
            </div>
            <ErrorBanner error={create.error} />
            {create.isSuccess && <div className="banner banner-info" role="status">Account created.</div>}
            <button className="btn btn-primary" type="submit" disabled={create.isPending || username.trim().length < 3 || password.length < 12}>
              {create.isPending ? "Creating…" : "Create account"}
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}

export function AuditPage() {
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => endpoints.audit(200), refetchInterval: 30_000 });
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p>Sign-ins, uploads, analyses, account changes and denied access attempts (latest 200).</p>
        </div>
      </div>
      <Card flush>
        {audit.isPending && <Loading />}
        {audit.isError && <div className="card-body"><ErrorBanner error={audit.error} /></div>}
        {audit.data && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>Outcome</th><th>Detail</th></tr></thead>
              <tbody>
                {audit.data.map((e) => (
                  <tr key={e.id}>
                    <td className="secondary num">{formatDateTime(e.at)}</td>
                    <td>{e.username ?? "—"}</td>
                    <td className="mono">{e.action}</td>
                    <td className="secondary">{e.entityType ? `${e.entityType}${e.entityId ? ` #${e.entityId}` : ""}` : "—"}</td>
                    <td>
                      {e.outcome === "SUCCESS" ? <Badge tone="good">Success</Badge>
                        : e.outcome === "DENIED" ? <Badge tone="warning">Denied</Badge> : <Badge tone="critical">Failure</Badge>}
                    </td>
                    <td className="secondary">{e.detail ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
