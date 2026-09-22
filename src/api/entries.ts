import {
  apiClient,
  ApiError,
  UploadInterruptedError,
  getServerOrigin,
  buildAuthHeaders,
  notifyApiActivity,
  notifyApiAuthFailure,
} from './client'
import type {
  EntryDetail,
  EntryCompact,
  EntryOtp,
  CreateEntryRequest,
  UpdateEntryRequest,
  MoveRequest,
  ApiErrorResponse,
} from './types'

/**
 * Builds a Content-Disposition header value that is always a valid HTTP
 * ByteString. `XMLHttpRequest.setRequestHeader` throws synchronously on any
 * code point > U+00FF (CJK, Cyrillic, en-dash, curly quotes — all common in
 * real filenames), which would otherwise reject the whole upload. We emit an
 * ASCII-only `filename="..."` (with quotes/backslashes/control chars stripped)
 * for the server's simple parser, plus an RFC 5987 `filename*` carrying the
 * exact UTF-8 name for compliant clients.
 */
function buildContentDisposition(name: string): string {
  const asciiFallback = name
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(name)
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`
}

/** Maximum document size accepted by the PD Server (matches REST API v2.0 spec). */
export const MAX_DOCUMENT_SIZE = 64 * 1024 * 1024 // 64 MB

export function getEntry(
  dbId: string,
  entryId: string,
  secondPassword?: string,
): Promise<EntryDetail> {
  return apiClient<EntryDetail>(`/databases/${dbId}/entries/${entryId}`, {
    secondPassword,
  })
}

/**
 * The entry's current one-time code (Server 20.0.0+; check `has_otp` first).
 * Every call is an audited read on the server and fires "password accessed"
 * alerts, so fetch on an explicit user action, never on a timer. Long-lived
 * API tokens are refused. Errors to tell apart by `ApiError.code`:
 * 4031 wrong/missing second password (for a link, possibly the target's),
 * 4041 the entry has no one-time code, plain 403 no permission or sealed.
 */
export function getEntryOtp(
  dbId: string,
  entryId: string,
  secondPassword?: string,
): Promise<EntryOtp> {
  return apiClient<EntryOtp>(`/databases/${dbId}/entries/${entryId}/otp`, {
    secondPassword,
  })
}

export function createEntry(
  dbId: string,
  data: CreateEntryRequest,
  parentFolderId?: string | null,
): Promise<EntryCompact> {
  const url = parentFolderId
    ? `/databases/${dbId}/entries?parent=${parentFolderId}`
    : `/databases/${dbId}/entries`
  return apiClient<EntryCompact>(url, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateEntry(
  dbId: string,
  entryId: string,
  data: UpdateEntryRequest,
  secondPassword?: string,
): Promise<EntryCompact> {
  return apiClient<EntryCompact>(`/databases/${dbId}/entries/${entryId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    secondPassword,
  })
}

/**
 * Server 20.0.0+ moves the item to the database's recycle bin unless `mode` is
 * `'permanent'`; an older server ignores the parameter and always destroys it,
 * so pass `'permanent'` when the caller means gone, and read
 * `database.recycle_bin.enabled` before telling anyone it can be undone.
 */
export function deleteEntry(
  dbId: string,
  entryId: string,
  mode?: 'recycle' | 'permanent',
): Promise<void> {
  const query = mode ? `?mode=${mode}` : ''
  return apiClient<void>(`/databases/${dbId}/entries/${entryId}${query}`, {
    method: 'DELETE',
  })
}

export function moveEntry(
  dbId: string,
  entryId: string,
  data: MoveRequest,
): Promise<EntryCompact> {
  return apiClient<EntryCompact>(`/databases/${dbId}/entries/${entryId}/move`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function downloadDocument(dbId: string, entryId: string): Promise<{ blob: Blob; filename: string }> {
  const base = `${getServerOrigin()}/v2.0`
  const response = await fetch(`${base}/databases/${dbId}/entries/${entryId}/content`, {
    headers: buildAuthHeaders(),
    // Document contents are sensitive — keep them out of the disk cache.
    cache: 'no-store',
  })

  if (!response.ok) {
    if (response.status === 401) notifyApiAuthFailure()
    // Mirror apiClient: prefer the server's JSON error body (already
    // localized and actionable, e.g. "document content not found") over the
    // bare HTTP status text.
    let code = response.status
    let message = response.statusText
    try {
      const body = (await response.json()) as ApiErrorResponse
      code = body.error.code
      message = body.error.message
    } catch {
      // Non-JSON response — fall back to status text.
    }
    throw new ApiError(response.status, code, message)
  }
  notifyApiActivity()

  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
  const filename = filenameMatch?.[1] ?? 'download'

  return { blob, filename }
}

export interface UploadOptions {
  /** Called on each upload progress tick with a 0..1 fraction. */
  onProgress?: (fraction: number) => void
  /** Optional AbortSignal to cancel the upload. */
  signal?: AbortSignal
}

/**
 * Upload document content via XHR so we can surface progress to the UI.
 * Mirrors apiClient: attaches Authorization, resets the session watchdog on
 * success, throws ApiError on non-2xx responses, and auto-logs-out on 401.
 */
export function uploadDocument(
  dbId: string,
  entryId: string,
  file: File,
  options: UploadOptions = {},
): Promise<EntryCompact> {
  const base = `${getServerOrigin()}/v2.0`
  const authHeaders = buildAuthHeaders()

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `${base}/databases/${dbId}/entries/${entryId}/content`)
    for (const [name, value] of Object.entries(authHeaders)) {
      xhr.setRequestHeader(name, value)
    }
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')
    try {
      xhr.setRequestHeader('Content-Disposition', buildContentDisposition(file.name))
    } catch {
      // Extremely defensive: if the header value is somehow still rejected,
      // upload without it rather than failing the whole transfer — the server
      // keeps the entry's existing name.
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && options.onProgress) {
        options.onProgress(event.loaded / event.total)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        notifyApiActivity()
        try {
          resolve(xhr.responseText ? (JSON.parse(xhr.responseText) as EntryCompact) : (undefined as unknown as EntryCompact))
        } catch (err) {
          reject(err)
        }
        return
      }
      let code = xhr.status
      let message = xhr.statusText
      try {
        const body = JSON.parse(xhr.responseText) as { error?: { code: number; message: string } }
        if (body.error) {
          code = body.error.code
          message = body.error.message
        }
      } catch {
        // Non-JSON response — fall back to status text.
      }
      if (xhr.status === 401) {
        notifyApiAuthFailure()
      }
      reject(new ApiError(xhr.status, code, message))
    }

    // No user-facing text here: the api/ layer has no i18n. The UI turns the
    // typed error into a localized message (describeApiError).
    xhr.onerror = () => reject(new UploadInterruptedError())
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'))

    if (options.signal) {
      if (options.signal.aborted) {
        xhr.abort()
        return
      }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }

    xhr.send(file)
  })
}
