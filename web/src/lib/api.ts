import type { AppConfig, Project, ProjectSummary, Provenance } from "./types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";
const KEY_STORAGE = "gp_editor_key";

export function editorKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setEditorKey(value: string) {
  try {
    localStorage.setItem(KEY_STORAGE, value);
  } catch {
    /* private mode: the key lasts for this page only */
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const key = editorKey();
  if (key) headers["X-Editor-Key"] = key;
  const response = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      message = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* not JSON */
    }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  config: () => request<AppConfig>("GET", "/api/config"),
  sign: (params_to_sign: Record<string, unknown>) => request<{ signature: string }>("POST", "/api/sign", { params_to_sign }),
  projects: () => request<ProjectSummary[]>("GET", "/api/projects"),
  createProject: (body: Record<string, unknown>) => request<Project>("POST", "/api/projects", body),
  project: (pid: string) => request<Project>("GET", `/api/projects/${pid}`),
  createSite: (pid: string, body: Record<string, unknown>) => request<Project>("POST", `/api/projects/${pid}/sites`, body),
  updateSite: (pid: string, sid: string, body: Record<string, unknown>) => request<Project>("PATCH", `/api/projects/${pid}/sites/${sid}`, body),
  ingest: (pid: string, public_id: string, resource_type: string) =>
    request<{ id: string }>("POST", `/api/projects/${pid}/evidence`, { public_id, resource_type }),
  sync: (pid: string) => request<{ queued: number }>("POST", `/api/projects/${pid}/sync`),
  retry: (pid: string, eid: string) => request("POST", `/api/projects/${pid}/evidence/${encodeURIComponent(eid)}/retry`),
  updateEvidence: (pid: string, eid: string, body: Record<string, unknown>) =>
    request<Project>("PATCH", `/api/projects/${pid}/evidence/${encodeURIComponent(eid)}`, body),
  provenance: (pid: string, eid: string) => request<Provenance>("GET", `/api/projects/${pid}/evidence/${encodeURIComponent(eid)}/provenance`),
  search: (pid: string, params: Record<string, string>) =>
    request<{ items: { id: string; match: string | null }[]; visual: boolean | null }>(
      "GET",
      `/api/projects/${pid}/search?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`,
    ),
  addMeasurement: (pid: string, body: Record<string, unknown>) => request<Project>("POST", `/api/projects/${pid}/measurements`, body),
  deleteMeasurement: (pid: string, mid: string) => request<Project>("DELETE", `/api/projects/${pid}/measurements/${mid}`),
  createStory: (pid: string) => request<{ id: string }>("POST", `/api/projects/${pid}/stories`),
  report: (token: string) => request<Project>("GET", `/api/public/${token}`),
  publicProvenance: (token: string, eid: string) => request<Provenance>("GET", `/api/public/${token}/evidence/${encodeURIComponent(eid)}`),
};
