const apiUrl = import.meta.env.VITE_API_URL ?? ''

export async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  return request<T>(path, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export async function apiGetPublic<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, { cache: 'no-store', ...init })
}

export async function apiPost<T>(path: string, accessToken: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export async function apiPatch<T>(path: string, accessToken: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

export async function apiDelete(path: string, accessToken: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    throw new ApiError('', 0)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null
    throw new ApiError(body?.message || `Error ${response.status}`, response.status)
  }
}

export async function apiPostPublic<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export class ApiError extends Error {
  readonly status: number
  readonly retryAfterSeconds?: number

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

export function apiErrorMessage(reason: unknown): string {
  if (reason instanceof ApiError) {
    return reason.status > 0 ? `API Error ${reason.status}` : 'API Error'
  }
  return 'API Error'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiUrl}${path}`, init)
  } catch {
    throw new ApiError('', 0)
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as {
      message?: string
      retryAfterSeconds?: number
    } | null
    throw new ApiError(
      body?.message || `Error ${response.status}`,
      response.status,
      body?.retryAfterSeconds,
    )
  }

  return response.json() as Promise<T>
}
