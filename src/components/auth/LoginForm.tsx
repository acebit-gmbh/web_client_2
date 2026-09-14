import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ServerFields } from './ServerFields'
import { AuthMethodSelect } from './AuthMethodSelect'
import { StandardFields } from './StandardFields'
import { SspiFields } from './SspiFields'
import { NegotiateFields } from './NegotiateFields'
import { AzureFields } from './AzureFields'
import { WebAuthnFields } from './WebAuthnFields'
import { OidcProviderSelect } from './OidcProviderSelect'
import { TfaInline } from './TfaInline'
import { useAuthStore } from '@/stores/authStore'
import { useOptionsStore } from '@/stores/optionsStore'
import { useConnectionStore } from '@/stores/connectionStore'
import { useWebAuthnLogin } from '@/hooks/useWebAuthnLogin'
import { login, getProfile, getOidcProviders } from '@/api/auth'
import {
  buildOidcAuthUrl,
  buildAzureAuthUrl,
  parseOidcCallback,
  parseOidcCallbackError,
  hasOidcCallbackParams,
} from '@/lib/oidc'
import { getConfig } from '@/lib/config'
import { ApiError } from '@/api/client'
import { describeLoginError } from '@/lib/apiErrors'
import {
  getCachedProviders,
  setCachedProviders,
} from '@/lib/oidcProviderCache'
import type { AuthMethod, OidcProvider, LoginRequest } from '@/api/types'

type LoginPhase = 'credentials' | 'tfa'

interface TfaState {
  isSetup: boolean
  qrCodeUrl?: string
  deliveryInfo: string
}

export function LoginForm() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const config = getConfig()
  const options = useOptionsStore()
  const connection = useConnectionStore()
  const setAuth = useAuthStore((s) => s.setAuth)

  const isBundled = config.bundled

  // ── Server fields ──────────────────────────────────────────
  // Priority: (1) last used server from recentServers, (2) user options default, (3) config.json
  const lastServer = options.recentServers[0] ?? ''
  // Split at the LAST colon so both "host:port" and IPv6 literals parse: the
  // port is always the final segment.
  const lastColon = lastServer.lastIndexOf(':')
  const lastHost = lastColon > -1 ? lastServer.slice(0, lastColon) : lastServer
  const lastPort = lastColon > -1 ? lastServer.slice(lastColon + 1) : ''

  // Resolve the effective server once so the field initializers AND the cached
  // OIDC-provider lookup describe the same server (they used to disagree).
  const effectiveHost = lastHost || options.defaultServer || config.defaultServer
  const effectivePort = lastPort || options.defaultPort || config.defaultPort || '8714'

  const [serverAddress, setServerAddress] = useState(effectiveHost)
  const [serverPort, setServerPort] = useState(effectivePort)

  // ── Auth method ────────────────────────────────────────────
  const [authMethod, setAuthMethod] = useState<AuthMethod>(() => {
    const resolved = options.lastAuthMethod ?? config.defaultAuthMethod ?? 'standard'
    // A method disabled via config.json must not be selectable — otherwise the
    // selector shows "Standard" while the form would still run the hidden one.
    if (config.disabledAuthModes.includes(resolved)) {
      const order: AuthMethod[] = ['standard', 'sspi', 'negotiate', 'webauthn', 'oidc', 'azure']
      return order.find((m) => !config.disabledAuthModes.includes(m)) ?? 'standard'
    }
    return resolved
  })

  // ── Credential fields ──────────────────────────────────────
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  // ── OIDC state ─────────────────────────────────────────────
  const [oidcProviders, setOidcProviders] = useState<OidcProvider[]>(() => {
    if (isBundled) return connection.oidcProviders
    return getCachedProviders(effectiveHost, effectivePort) ?? []
  })
  const [selectedOidcProvider, setSelectedOidcProvider] = useState<string | null>(
    options.lastOidcProvider,
  )
  const [isRefreshingOidc, setIsRefreshingOidc] = useState(false)

  // ── Login state ────────────────────────────────────────────
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('credentials')
  const [tfaState, setTfaState] = useState<TfaState>({
    isSetup: false,
    deliveryInfo: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const pendingCredentialsRef = useRef<LoginRequest | null>(null)
  const submittingRef = useRef(false)

  // ── Server contact tracking ────────────────────────────────
  const serverContactedRef = useRef(false)

  // ── WebAuthn hook ──────────────────────────────────────────
  const handleAuthSuccess = useCallback(() => {
    navigate('/vault', { replace: true })
  }, [navigate])

  const handleAuthError = useCallback((msg: string) => {
    setLoginError(msg)
  }, [])

  const webauthn = useWebAuthnLogin(handleAuthSuccess, handleAuthError)

  // ── Fetch OIDC providers silently ──────────────────────────
  const fetchingRef = useRef(false)

  const fetchProviders = useCallback(
    async (addr?: string, port?: string) => {
      const a = addr ?? serverAddress
      const p = port ?? serverPort
      if (!isBundled && !a.trim()) return
      if (fetchingRef.current) return
      fetchingRef.current = true

      // Set server in connection store so apiClient resolves the right base URL
      if (!isBundled) {
        connection.setServer(a.trim(), p.trim() || '8714')
      }

      setIsRefreshingOidc(true)
      setServerError(null)

      try {
        const response = await getOidcProviders()
        const providers = response.data ?? []
        setOidcProviders(providers)
        if (!isBundled) {
          setCachedProviders(a.trim(), p.trim() || '8714', providers)
        }
        connection.setConnected(providers)
        serverContactedRef.current = true

        // Save to recent servers
        if (!isBundled) {
          const entry = `${a.trim()}:${p.trim() || '8714'}`
          options.addRecentServer(entry)
        }
      } catch (err) {
        let message: string
        if (err instanceof ApiError) {
          message = err.message
        } else if (err instanceof TypeError) {
          // fetch() throws TypeError for network errors: TLS failures, DNS, CORS, offline
          message = t('login.connectionFailedDetail')
        } else {
          message = t('login.serverUnreachable')
        }
        setServerError(message)
        if (!isBundled) {
          connection.setConnectionError(message)
        }
      } finally {
        setIsRefreshingOidc(false)
        fetchingRef.current = false
      }
    },
    [serverAddress, serverPort, isBundled, connection, options, t],
  )

  // ── Auto-fetch providers on mount if server is known ───────
  useEffect(() => {
    if (serverContactedRef.current) return
    if (isBundled || serverAddress.trim()) {
      fetchProviders()
    }
    // Run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Handle OIDC callback (redirect back from IdP) ─────────
  const oidcCallbackHandledRef = useRef(false)

  useEffect(() => {
    if (oidcCallbackHandledRef.current) return
    // OIDC providers using auth-code flow return params in the query string
    // (response_mode=query). Microsoft Entra requires fragment mode for any
    // response that includes an id_token, so main.tsx captures the fragment
    // before HashRouter mounts and stashes it here under 'pd-oidc-fragment'.
    // Prefer the stashed fragment if present, otherwise fall back to query.
    const stashedFragment = sessionStorage.getItem('pd-oidc-fragment')
    sessionStorage.removeItem('pd-oidc-fragment')
    const urlParams = new URLSearchParams(stashedFragment ?? window.location.search)

    // First check for an explicit error response from the IdP — e.g. a
    // misconfigured Entra ID redirect URI returns ?error=invalid_client.
    // Without surfacing this, the user would just see the login form again
    // with no feedback, mistaking it for a stuck Sign-In.
    const oidcError = parseOidcCallbackError(urlParams)
    if (oidcError) {
      oidcCallbackHandledRef.current = true
      window.history.replaceState(null, '', window.location.pathname + window.location.hash)
      setLoginError(`${t('login.oidcFailed')} (${oidcError})`)
      setIsSubmitting(false)
      return
    }

    const oidcResult = parseOidcCallback(urlParams)
    if (!oidcResult) {
      // Distinguish "no callback present" from "callback present but
      // validation failed" — the latter happens legitimately when the IdP
      // redirect lands in a different tab (the saved state lives in tab-scoped
      // sessionStorage) or the nonce check fails. Don't drop it silently.
      if (hasOidcCallbackParams(urlParams)) {
        oidcCallbackHandledRef.current = true
        window.history.replaceState(null, '', window.location.pathname + window.location.hash)
        setLoginError(t('login.oidcValidationFailed'))
        setIsSubmitting(false)
      }
      return
    }

    oidcCallbackHandledRef.current = true

    // Clear the URL query params so a page refresh doesn't re-trigger
    window.history.replaceState(null, '', window.location.pathname + window.location.hash)

    // Complete the OIDC login via performLogin-style flow
    setIsSubmitting(true)
    setLoginError(null)

    // Build the login request — Azure uses auth:'azure' with just id_token,
    // OIDC uses auth:'oidc' with idp + id_token
    const oidcRequest: LoginRequest =
      oidcResult.auth === 'azure'
        ? { auth: 'azure', id_token: oidcResult.id_token, scope: 'client' }
        : { auth: 'oidc', idp: oidcResult.idp, id_token: oidcResult.id_token, scope: 'client' }

    login(oidcRequest)
      .then(async (result) => {
        useAuthStore.getState().setToken(result.access_token)
        try {
          const profile = await getProfile()
          setAuth(result.access_token, profile)
          navigate('/vault', { replace: true })
        } catch (profileErr) {
          // Don't leave an orphaned token persisted if the profile fetch fails
          // after the grant — clear it and revoke the server session.
          useAuthStore.getState().logout({ broadcast: false, revoke: true })
          throw profileErr
        }
      })
      .catch((err) => {
        if (err instanceof ApiError) {
          if (err.code === 459) {
            pendingCredentialsRef.current = oidcRequest
            setTfaState({ isSetup: true, qrCodeUrl: err.message, deliveryInfo: '' })
            setLoginPhase('tfa')
          } else if (err.code === 460) {
            pendingCredentialsRef.current = oidcRequest
            setTfaState({ isSetup: false, deliveryInfo: err.message })
            setLoginPhase('tfa')
          } else {
            setLoginError(describeLoginError(err, t))
          }
        } else {
          setLoginError(t('login.unexpectedError'))
        }
      })
      .finally(() => {
        setIsSubmitting(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Reset stuck spinner after bfcache restore ──────────────
  // The OIDC/Azure submit sets isSubmitting before redirecting to the IdP. If
  // the user clicks Back, Safari/Firefox restore this page from the back/
  // forward cache with that flag still true, leaving the form disabled forever.
  useEffect(() => {
    function onPageShow(e: PageTransitionEvent) {
      if (e.persisted) setIsSubmitting(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  // ── Persist auth method changes ────────────────────────────
  function handleAuthMethodChange(method: AuthMethod) {
    setAuthMethod(method)
    setLoginError(null)
    options.setLastAuthMethod(method)
  }

  // ── OIDC provider selection ────────────────────────────────
  function handleOidcProviderSelect(id: string) {
    setSelectedOidcProvider(id)
    options.setLastOidcProvider(id)
  }

  // ── Core login ─────────────────────────────────────────────
  async function performLogin(request: LoginRequest) {
    submittingRef.current = true
    setLoginError(null)
    setIsSubmitting(true)

    try {
      const result = await login(request)

      useAuthStore.getState().setToken(result.access_token)
      try {
        const profile = await getProfile()
        setAuth(result.access_token, profile)
        navigate('/vault', { replace: true })
      } catch (profileErr) {
        // The token was granted but the profile fetch failed (5xx / network —
        // a 401 already self-clears via apiClient). Clear the orphaned token
        // and revoke the server session instead of leaving both alive.
        useAuthStore.getState().logout({ broadcast: false, revoke: true })
        throw profileErr
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 459) {
          pendingCredentialsRef.current = request
          setTfaState({
            isSetup: true,
            qrCodeUrl: err.message,
            deliveryInfo: '',
          })
          setLoginPhase('tfa')
        } else if (err.code === 460) {
          pendingCredentialsRef.current = request
          setTfaState({
            isSetup: false,
            deliveryInfo: err.message,
          })
          setLoginPhase('tfa')
        } else {
          setLoginError(describeLoginError(err, t))
        }
      } else {
        const detail = err instanceof Error ? err.message : String(err)
        // Log only the message — full error objects may include the password
        // payload or server hints that we don't want in browser logs.
        console.error('Login failed:', detail)
        if (request.auth === 'negotiate') {
          setLoginError(`${t('login.negotiateFailed')} (${detail})`)
        } else if (request.auth === 'sspi') {
          setLoginError(`${t('login.sspiFailed')} (${detail})`)
        } else {
          setLoginError(detail || t('login.unexpectedError'))
        }
      }
    } finally {
      setIsSubmitting(false)
      submittingRef.current = false
    }
  }

  // ── Form submit handler ────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submittingRef.current) return

    // Ensure server is set in connection store (non-bundled)
    if (!isBundled) {
      connection.setServer(serverAddress.trim(), serverPort.trim() || '8714')
    }

    switch (authMethod) {
      case 'standard':
        await performLogin({ user: username, pass: password, auth: 'standard', scope: 'client' })
        break

      case 'sspi':
        await performLogin({ user: username, pass: password, auth: 'sspi', scope: 'client' })
        break

      case 'negotiate':
        await performLogin({ auth: 'negotiate', scope: 'client' })
        break

      case 'webauthn':
        if (!username.trim()) {
          setLoginError(t('login.usernameRequired'))
          return
        }
        await webauthn.execute(username)
        break

      case 'oidc': {
        if (!selectedOidcProvider) {
          setLoginError(t('login.oidcSelectRequired'))
          return
        }
        const provider = oidcProviders.find((p) => p.id === selectedOidcProvider)
        if (!provider) return
        setIsSubmitting(true)
        setLoginError(null)
        try {
          const url = await buildOidcAuthUrl(provider)
          window.location.href = url
        } catch (err) {
          setLoginError(
            err instanceof Error ? err.message : t('login.unexpectedError'),
          )
          setIsSubmitting(false)
        }
        break
      }

      case 'azure': {
        setIsSubmitting(true)
        setLoginError(null)
        try {
          const url = await buildAzureAuthUrl()
          window.location.href = url
        } catch (err) {
          setLoginError(
            err instanceof Error ? err.message : t('login.unexpectedError'),
          )
          setIsSubmitting(false)
        }
        break
      }
    }
  }

  // ── 2FA submit ─────────────────────────────────────────────
  // Deliberately does NOT route through performLogin: it must REthrow failures
  // so TfaInline can show the inline error and clear the input, and it must
  // preserve the setup QR on a repeated 460 instead of unmounting it.
  async function handleTfaSubmit(code: string) {
    const pending = pendingCredentialsRef.current
    if (!pending) return
    const request: LoginRequest = { ...pending, tfacode: code }
    try {
      const result = await login(request)
      useAuthStore.getState().setToken(result.access_token)
      try {
        const profile = await getProfile()
        setAuth(result.access_token, profile)
        setLoginPhase('credentials')
        navigate('/vault', { replace: true })
      } catch (profileErr) {
        useAuthStore.getState().logout({ broadcast: false, revoke: true })
        throw profileErr
      }
    } catch (err) {
      // 459 on resubmit: refresh the QR but stay in setup. 460 (wrong/expired
      // code): leave the current QR/delivery info untouched. Either way the
      // error is rethrown so TfaInline surfaces it and clears the OTP field.
      if (err instanceof ApiError && err.code === 459) {
        setTfaState({ isSetup: true, qrCodeUrl: err.message, deliveryInfo: '' })
      }
      throw err
    }
  }

  function handleTfaBack() {
    setLoginPhase('credentials')
    setLoginError(null)
    pendingCredentialsRef.current = null
  }

  // ── Derived state ──────────────────────────────────────────
  const isLoading = isSubmitting || webauthn.isLoading

  const signInDisabled =
    isLoading ||
    (!isBundled && !serverAddress.trim()) ||
    (authMethod === 'webauthn' && !username.trim()) ||
    (authMethod === 'oidc' && !selectedOidcProvider)

  // ── Render ─────────────────────────────────────────────────
  if (loginPhase === 'tfa') {
    return (
      <TfaInline
        isSetup={tfaState.isSetup}
        qrCodeUrl={tfaState.qrCodeUrl}
        deliveryInfo={tfaState.deliveryInfo}
        onSubmit={handleTfaSubmit}
        onBack={handleTfaBack}
      />
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Server fields (hidden in bundled mode) */}
      {!isBundled && (
        <ServerFields
          address={serverAddress}
          port={serverPort}
          onAddressChange={(v) => {
            setServerAddress(v)
            serverContactedRef.current = false
            setServerError(null)
          }}
          onPortChange={(v) => {
            setServerPort(v)
            serverContactedRef.current = false
            setServerError(null)
          }}
          disabled={isLoading}
          error={serverError}
        />
      )}

      {/* Auth method selector */}
      <AuthMethodSelect
        value={authMethod}
        onChange={handleAuthMethodChange}
        disabled={isLoading}
        disabledMethods={config.disabledAuthModes}
      />

      {/* Method-specific fields */}
      {authMethod === 'standard' && (
        <StandardFields
          username={username}
          password={password}
          onUsernameChange={setUsername}
          onPasswordChange={setPassword}
          disabled={isLoading}
        />
      )}

      {authMethod === 'sspi' && (
        <SspiFields
          username={username}
          password={password}
          onUsernameChange={setUsername}
          onPasswordChange={setPassword}
          disabled={isLoading}
        />
      )}

      {authMethod === 'negotiate' && <NegotiateFields />}

      {authMethod === 'webauthn' && (
        <WebAuthnFields
          username={username}
          onUsernameChange={setUsername}
          disabled={isLoading}
        />
      )}

      {authMethod === 'oidc' && (
        <OidcProviderSelect
          providers={oidcProviders}
          selectedId={selectedOidcProvider}
          onSelect={handleOidcProviderSelect}
          onRefresh={() => fetchProviders()}
          isRefreshing={isRefreshingOidc}
          disabled={isLoading}
        />
      )}

      {authMethod === 'azure' && <AzureFields />}

      {/* Error display */}
      {loginError && (
        <Alert variant="destructive">
          <AlertDescription>{loginError}</AlertDescription>
        </Alert>
      )}

      {/* Sign In button */}
      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={signInDisabled}
      >
        {isLoading && <Loader2 className="animate-spin" />}
        {t('login.signIn')}
      </Button>
    </form>
  )
}
