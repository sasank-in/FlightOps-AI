/**
 * Minimal fetch client for the backend (same origin via the /api proxy). Errors are parsed from
 * RFC 9457 problem JSON into ApiError; a 401 on an authenticated call triggers the registered
 * unauthorized handler (sign-out).
 */

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: { field: string; message: string }[];

  constructor(status: number, message: string, fieldErrors: { field: string; message: string }[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

type UnauthorizedHandler = () => void;

let token: string | null = null;
let onUnauthorized: UnauthorizedHandler = () => {};

export function setToken(value: string | null): void {
  token = value;
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler): void {
  onUnauthorized = handler;
}

const FALLBACK: Record<number, string> = {
  400: "The request was not valid.",
  401: "Your session has expired. Please sign in again.",
  403: "You do not have permission for this action.",
  404: "Not found.",
  409: "The request conflicts with the current state.",
  413: "The upload is too large.",
  429: "Too many requests. Please wait and try again.",
  503: "A required service is unavailable.",
};

async function toError(res: Response): Promise<ApiError> {
  let detail: string | undefined;
  let fieldErrors: { field: string; message: string }[] = [];
  try {
    const body = (await res.json()) as { detail?: string; errors?: { field: string; message: string }[] };
    detail = typeof body.detail === "string" ? body.detail : undefined;
    fieldErrors = Array.isArray(body.errors) ? body.errors : [];
  } catch {
    // non-JSON error body
  }
  return new ApiError(res.status, detail ?? FALLBACK[res.status] ?? `Request failed (HTTP ${res.status}).`, fieldErrors);
}

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean; text?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true, text = false } = init;
  const headers: Record<string, string> = { Accept: text ? "text/markdown, text/plain;q=0.9, application/problem+json;q=0.5" : "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Cannot reach the FlightOps backend. Check that it is running.");
  }
  if (!res.ok) {
    const err = await toError(res);
    if (res.status === 401 && auth) onUnauthorized();
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (text ? await res.text() : await res.json()) as T;
}
