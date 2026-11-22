import { apiClient, ApiError } from './client'
import { WEB_CLIENT_IDENTITY } from './clientIdentity'
import type {
  LoginRequest,
  LoginResponse,
  UserProfile,
  ChangePasswordRequest,
  UpdateProfileRequest,
  OidcProvider,
  PaginatedResponse,
} from './types'

export function login(data: LoginRequest): Promise<LoginResponse> {
  // Negotiate auth uses HTTP-level SPNEGO handshake — the browser must
  // respond to the server's WWW-Authenticate: Negotiate challenge,
  // which requires credentials: 'include' on the fetch request.
  const isNegotiate = data.auth === 'negotiate'

  return withServerRefusal(() =>
    apiClient<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ ...data, client: WEB_CLIENT_IDENTITY }),
      skipAuth: true,
      credentials: isNegotiate ? 'include' : undefined,
    }),
  )
}

/**
 * Sends a sign-in request and, where the browser could not send it at all,
 * asks the server why.
 *
 * A server that refuses every request - one that has been replaced by another
 * primary server, one that is handing over to its mirror, a mirror that is
 * leaving its primary server - refuses the browser's CORS preflight as well.
 * The browser then reports the sign-in as a network error (a TypeError) and
 * the server's own text never arrives. The OIDC provider list is a request
 * the browser sends without a preflight (a GET with no token and no body), so
 * its 403 carries that text: it is thrown in place of the network error, and
 * the sign-in form shows it as it shows every refusal. Any other answer to
 * that request, or none, leaves the network error as it was.
 */
export async function withServerRefusal<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send()
  } catch (err) {
    if (!(err instanceof TypeError)) throw err
    let refusal: ApiError | null = null
    try {
      await getOidcProviders()
    } catch (probeErr) {
      if (probeErr instanceof ApiError && probeErr.status === 403 && probeErr.message) {
        refusal = probeErr
      }
    }
    throw refusal ?? err
  }
}

export function logout(): Promise<void> {
  return apiClient<void>('/auth/logout', { method: 'POST' })
}

export function getProfile(): Promise<UserProfile> {
  return apiClient<UserProfile>('/me')
}

export function updateProfile(data: UpdateProfileRequest): Promise<UserProfile> {
  return apiClient<UserProfile>('/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function changePassword(data: ChangePasswordRequest): Promise<void> {
  return apiClient<void>('/me/password', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** Fetch OIDC providers — also used as a connectivity test (no auth required) */
export function getOidcProviders(): Promise<PaginatedResponse<OidcProvider>> {
  return apiClient<PaginatedResponse<OidcProvider>>('/auth/oidc', {
    skipAuth: true,
  })
}
