import { apiClient } from './client'
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

  return apiClient<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ ...data, client: WEB_CLIENT_IDENTITY }),
    skipAuth: true,
    credentials: isNegotiate ? 'include' : undefined,
  })
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
