"use client";

/**
 * Frontend API client: uniform envelope handling + CSRF origin guard.
 * Every response is { ok, data } | { ok: false, error, code }.
 */

export class ApiClientError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "x-gadaa-client": "web",
      ...init?.headers,
    },
    credentials: "same-origin",
  });

  let json: { ok?: boolean; data?: T; error?: string; code?: string };
  try {
    json = await res.json();
  } catch {
    throw new ApiClientError(`Request failed (${res.status})`, "NETWORK", res.status);
  }

  if (!res.ok || json.ok === false) {
    throw new ApiClientError(json.error ?? `Request failed (${res.status})`, json.code ?? "ERROR", res.status);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined }),
};
