import { apiClient } from './client'
import { WEB_CLIENT_IDENTITY } from './clientIdentity'
import type { LoginResponse } from './types'

export interface WebAuthnBeginResponse {
  session_id: string
  publicKey: {
    challenge: string
    rpId: string
    allowCredentials: Array<{ type: string; id: string; transports?: string[] }>
    userVerification: string
    timeout: number | string
  }
}

export interface WebAuthnCompleteRequest {
  session_id: string
  id: string
  response: {
    authenticatorData: string
    clientDataJSON: string
    signature: string
    userHandle: string | null
  }
}

export function webauthnBegin(
  user: string,
  scope: 'client' | 'admin' = 'client',
): Promise<WebAuthnBeginResponse> {
  return apiClient<WebAuthnBeginResponse>('/auth/webauthn/begin', {
    method: 'POST',
    body: JSON.stringify({ user, scope, client: WEB_CLIENT_IDENTITY }),
    skipAuth: true,
  })
}

export function webauthnComplete(data: WebAuthnCompleteRequest): Promise<LoginResponse> {
  return apiClient<LoginResponse>('/auth/webauthn/complete', {
    method: 'POST',
    body: JSON.stringify(data),
    skipAuth: true,
  })
}
