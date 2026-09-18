// ─── Error ───────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: {
    code: number
    message: string
  }
}

// ─── Authentication ──────────────────────────────────────────

export type AuthMethod = 'standard' | 'sspi' | 'negotiate' | 'webauthn' | 'oidc' | 'azure'

export interface LoginRequest {
  user?: string
  pass?: string
  scope?: 'client' | 'admin'
  auth?: 'standard' | 'sspi' | 'negotiate' | 'oidc' | 'azure'
  tfacode?: string
  idp?: string
  id_token?: string
}

export interface LoginResponse {
  access_token: string
}

export interface OidcProvider {
  id: string
  provider_class: string
  display_name: string
  discovery_endpoint: string
  client_id: string
  redirect_uri: string
  scopes: string[]
  response_types: string[]
}

// ─── User Profile ────────────────────────────────────────────

export interface UserProfile {
  id: string
  name: string
  auth_modes?: string[]
  display_name?: string
  department?: string
  email?: string
  phone?: string | null
  sam?: string | null
  upn?: string | null
  dn?: string | null
  objectId?: string | null
  disabled?: boolean
  must_change_pass?: boolean
  cannot_change_pass?: boolean
  roles?: string[]
  member_of?: string[]
  passkeys?: PasskeyCompact[]
  updated_at?: string
}

// ─── Passkeys (user's WebAuthn credentials) ──────────────────

export type PasskeyTransport = 'usb' | 'nfc' | 'ble' | 'internal' | 'hybrid'

export interface PasskeyCompact {
  id: string
  name: string
  transports?: PasskeyTransport[]
  created_at: string
  last_used_at?: string | null
}

export interface PasskeyDetail extends PasskeyCompact {
  type: 'public-key'
  alg: number
  sign_count: number
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}

export interface UpdateProfileRequest {
  display_name?: string
  department?: string
  phone?: string
}

// ─── Pagination ──────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  offset: number
  limit: number
  /** Set by the client pager when results were capped at the safety ceiling. */
  truncated?: boolean
}

// ─── Databases ───────────────────────────────────────────────

/**
 * Server 20.0.0+: what the server accepts for database icons, published on
 * every database object. Its PRESENCE is the capability marker - the server
 * then implements the whole icon contract (`/icons` routes, `database_icon`
 * on rows, validated `image_*` writes, `icon` always `ico<N>.svg`). Absent =
 * older server: never call `/icons`, never probe by POST.
 */
export interface DatabaseIconsCapability {
  /** Not a mirror, the caller may upload and the slot count is below `max_count`. 403/4034 can still occur. */
  can_upload: boolean
  accepted_types: string[]
  /** Largest accepted decoded PNG, in bytes. */
  max_bytes: number
  /** Largest accepted width and height, in pixels. */
  max_side: number
  max_count: number
  /** Most ids one `GET /icons?ids=` request may carry. */
  batch_max: number
}

export interface DatabaseCompact {
  id: string
  name: string
  description: string
  updated_at: string
  /** Server 20.0.0+: database-icon capability; absent on older servers (feature off). */
  icons?: DatabaseIconsCapability
}

// ─── Database Icons (Server 20.0.0+) ─────────────────────────

/**
 * Reference to an icon stored in the item's OWN database, as carried by
 * entry and folder rows. `id` is an opaque fetch handle valid only inside
 * that database (decimal digits, not a UUID and not a value for
 * `image_name`); `name` is the stable identifier and the value for
 * `image_name`; `version` changes whenever the stored image changes. Client
 * cache key: (server, database id, id, version).
 */
export interface DatabaseIconRef {
  id: string
  name: string
  version: string
}

/**
 * An icon of a database. The plain list carries `id`, `name` and `version`
 * only. The item route and `?ids=...&include=data` add `state`: `ok` (with
 * the image fields), `unusable` (the stored image cannot be served: show the
 * fallback and negative-cache by id + version) or `deferred` (response byte
 * budget reached: fetch it with the item route).
 */
export interface DatabaseIcon extends DatabaseIconRef {
  state?: string
  /** `image/png`, or `image/bmp` for legacy slots. Clients allow-list exactly these two. */
  content_type?: string
  width?: number
  height?: number
  /** RFC 4648 base64, standard alphabet, no line breaks, no `data:` prefix. */
  data?: string
}

/** Body of `POST /databases/{db}/icons`. `data` is a base64 PNG of at most `max_side` pixels per side and `max_bytes` bytes. */
export interface UploadIconRequest {
  name: string
  data: string
}

/**
 * Answer to an icon upload. `name` is authoritative - the server may have
 * stored the image as `name (2)` - and is what goes into `image_name`.
 * `created` is false when a byte-identical icon of that name already existed
 * (HTTP 200 instead of 201; nothing was written, retries are safe).
 */
export interface UploadIconResult extends DatabaseIconRef {
  created: boolean
}

// ─── Breadcrumbs ─────────────────────────────────────────────

export interface BreadcrumbSegment {
  id: string
  name: string
}

// ─── Folders ─────────────────────────────────────────────────

export interface FolderCompact {
  type: 'folder'
  id: string
  name: string
  /** Standard icon file name. Server 20.0.0+: always `ico<N>.svg` (N 0..134) and the fallback when `database_icon` is set. */
  icon?: string
  /** Server 20.0.0+: the folder's icon in its own database, or null; the key is absent on older servers. */
  database_icon?: DatabaseIconRef | null
  importance?: string
  category?: string
  tags?: string
  has_second_pass: boolean
  updated_at: string
}

export interface FolderDetail extends FolderCompact {
  path: BreadcrumbSegment[]
  author?: string
  image_custom?: boolean
  image_index?: number
  image_name?: string
  comments?: string
}

// ─── Entry Types ─────────────────────────────────────────────

export type EntryType =
  | 'password'
  | 'credit_card'
  | 'license'
  | 'identity'
  | 'information'
  | 'banking'
  | 'document'
  | 'rdp'
  | 'putty'
  | 'teamviewer'
  | 'custom'
  | 'passkey'

// ─── Entry Compact (from /children, /search) ─────────────────

export interface EntryCompact {
  type: EntryType
  id: string
  name: string
  has_second_pass: boolean
  /** Server 20.0.0+: a one-time code can be read with getEntryOtp. Absent on older servers. */
  has_otp?: boolean
  /** Server 20.0.0+: seedless one-time-code settings; absent on older servers. */
  totp?: EntryTotp
  login?: string | null
  url?: string | null
  /** Standard icon file name. Server 20.0.0+: always `ico<N>.svg` (N 0..134) and the fallback when `database_icon` is set. */
  icon?: string
  /** Server 20.0.0+: the entry's icon in its own database, or null; the key is absent on older servers. */
  database_icon?: DatabaseIconRef | null
  importance?: string
  category?: string
  tags?: string
  updated_at: string
  expires_at?: string | null
}

// ─── Compact Item (discriminated union) ──────────────────────

export type CompactItem = FolderCompact | EntryCompact

export function isFolder(item: CompactItem): item is FolderCompact {
  return item.type === 'folder'
}

export function isEntry(item: CompactItem): item is EntryCompact {
  return item.type !== 'folder'
}

// ─── Children Response ───────────────────────────────────────

export interface ChildrenResponse {
  /** Ancestor chain of the listed folder (server-driven breadcrumbs). */
  path: BreadcrumbSegment[]
  data: CompactItem[]
  total: number
  offset: number
  limit: number
  /** Set by the client pager when results were capped at the safety ceiling. */
  truncated?: boolean
}

// ─── Entry Type-Specific Fields ──────────────────────────────

export interface CustomField {
  name: string
  value: string
  input_id?: string
}

// Password/custom entries use top-level fields (login, pass, urls, etc.), so
// the type-specific sub-object is intentionally empty. `Record<string, never>`
// expresses "an object with no own fields" without matching every non-nullish
// value the way an empty interface (`{}`) would.
export type PasswordFields = Record<string, never>

export interface CreditCardFields {
  card?: string
  holder?: string
  number?: string
  valid_thru?: string
  cvv?: string
  phone?: string
  url?: string
  online_user?: string
  online_pass?: string
  pin?: string
}

export interface LicenseFields {
  product?: string
  version?: string
  reg_name?: string
  key_1?: string
  key_2?: string
  url?: string
  user?: string
  pass?: string
  purchase_date?: string | null
  order_number?: string
  reg_email?: string
}

export interface IdentityFields {
  account?: string
  email?: string
  first_name?: string
  last_name?: string
  company?: string
  address_1?: string
  address_2?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  phone?: string
  website?: string
  birth_date?: string | null
  mobile?: string
  fax?: string
  house?: string
}

export interface InformationFields {
  text?: string
}

export interface BankingFields {
  url?: string
  user?: string
  pass?: string
  holder?: string
  account_number?: string
  bank_id?: string
  bank_name?: string
  bic?: string
  iban?: string
  card_number?: string
  phone?: string
  legitimation_id?: string
  pin?: string
}

export interface DocumentFields {
  name?: string | null
  type?: string | null
  size?: number
}

export interface RdpFields {
  host?: string
  user?: string
  pass?: string
  cmd_line?: string
}

export interface PuttyFields {
  host?: string
  port?: number
  protocol?: string
  user?: string
  pass?: string
  key_file?: string
  key_pass?: string
  cmd_line?: string
}

export interface TeamViewerFields {
  partner_id?: string
  pass?: string
  mode?: string
}

export interface PasskeyFields {
  url?: string
  user?: string
  alg?: number
  sign_count?: number
  cred_id?: string
  rp_id?: string
  rp_name?: string
  user_id?: string
  key?: string
}

// ─── One-Time Code (GET /entries/{id}/otp) ───────────────────

export interface EntryOtp {
  /** The current code. A string: leading zeros are part of it - never parse it as a number. */
  code: string
  digits: number
  period: number
  /** Whole seconds until the code changes (server clock); the time actually left is in (expires_in - 1, expires_in]. */
  expires_in: number
  algorithm: 'SHA1' | 'SHA256' | 'SHA512'
}

/**
 * Server 20.0.0+: the entry's one-time-code settings without the seed, on
 * every entry representation. `state` is `hidden` (you may not read the
 * entry), `unsupported` (entry type), `set`, `invalid` (a seed is stored
 * but produces no code) or `none`; `has_otp` equals `state === 'set'`. The
 * compact form carries `state` only; the full form adds `writable` and, for
 * set/invalid, the stored parameters (`algorithm` is null for a value the
 * server does not know). Its presence - not its value - tells a client that
 * the server accepts `totp` on create and update; older servers omit it.
 */
export interface EntryTotp {
  state: string
  writable?: boolean
  digits?: number
  period?: number
  algorithm?: string | null
  conforming?: boolean
}

// ─── Entry Detail (full representation) ──────────────────────

export interface EntryDetail {
  path: BreadcrumbSegment[]
  type: EntryType
  id: string
  name: string
  has_second_pass: boolean
  /** Server 20.0.0+: a one-time code can be read with getEntryOtp. Absent on older servers. */
  has_otp?: boolean
  /** Server 20.0.0+: seedless one-time-code settings; absent on older servers. */
  totp?: EntryTotp
  author?: string
  /** Standard icon file name; see EntryCompact.icon. */
  icon?: string
  /** Server 20.0.0+: the entry's icon in its own database, or null; the key is absent on older servers. */
  database_icon?: DatabaseIconRef | null
  /** Raw stored value: true = the entry uses an icon of its database, named by `image_name`. */
  image_custom?: boolean
  /** Standard icon number 0..134 when `image_custom` is false; otherwise a server-maintained position that REST clients ignore. */
  image_index?: number
  /** Name of an icon stored in this database (not a file name). */
  image_name?: string
  comments?: string
  importance?: string
  category?: string
  tags?: string
  updated_at: string
  expires_at?: string | null

  // Main URL (the openable URL for the entry)
  url?: string | null

  // Password/custom type fields (top-level)
  login?: string
  login_id?: string
  pass?: string
  pass_id?: string
  urls?: string[]
  is_link?: boolean
  linked_item?: string | null
  is_template?: boolean
  info_template?: string | null
  param_str?: string
  custom_fields?: CustomField[]

  // Type-specific sub-objects
  credit_card?: CreditCardFields
  license?: LicenseFields
  identity?: IdentityFields
  information?: InformationFields
  banking?: BankingFields
  document?: DocumentFields
  rdp?: RdpFields
  putty?: PuttyFields
  teamviewer?: TeamViewerFields
  passkey?: PasskeyFields
}

// ─── Mutation Requests ───────────────────────────────────────

export type TotpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

/**
 * Server 20.0.0+: the write form of the `totp` key on create and update
 * (seedless `EntryTotp` is what comes back). `secret` is write-only Base32
 * and required on create; on update an absent `secret` keeps the stored seed
 * and only the members sent are applied. Send all four members whenever you
 * send a secret. `null` removes the code on update (and is a no-op on
 * create); an empty string is a shape error, never a clear. The key is
 * ignored by older servers, so send it only when the server reports `totp`
 * on its entries.
 */
export interface TotpWrite {
  secret?: string
  algorithm?: TotpAlgorithm
  digits?: number
  period?: number
}

/**
 * Server 20.0.0+: the icon keys of an entry write (`image_custom`,
 * `image_index`, `image_name` on create and update). A body with none of
 * them never changes the icon. Send them only in one of three forms:
 *
 * - database icon: `{image_custom: true, image_name: '<name from upload or list>'}`
 *   (the position is server-owned; a client-sent `image_index` is ignored)
 * - standard icon: `{image_custom: false, image_index: 0..134}`
 * - type default:  `{image_custom: false, image_index: -1}`
 *
 * A change to something unusable is refused with 400 / 4007 and nothing is
 * written. Older servers store the values unchecked, so send the keys only
 * when the database reports the `icons` capability.
 */
export type EntryIconWrite =
  | { image_custom: true; image_name: string }
  | { image_custom: false; image_index: number }

export interface CreateEntryRequest {
  type?: EntryType
  name: string
  login?: string
  pass?: string
  url?: string
  importance?: string
  category?: string
  tags?: string
  comments?: string
  custom_fields?: CustomField[]
  urls?: string[]
  expires_at?: string | null
  /** Server 20.0.0+: icon assignment, see EntryIconWrite. Send none of the three keys to leave the icon alone. */
  image_custom?: boolean
  image_index?: number
  image_name?: string
  /** Server 20.0.0+: one-time-code settings; `null` is accepted as a no-op here. */
  totp?: TotpWrite | null
  // Type-specific sub-objects
  credit_card?: CreditCardFields
  license?: LicenseFields
  identity?: IdentityFields
  information?: InformationFields
  banking?: BankingFields
  rdp?: RdpFields
  putty?: PuttyFields
  teamviewer?: TeamViewerFields
}

export interface UpdateEntryRequest {
  name?: string
  login?: string
  pass?: string
  url?: string
  importance?: string
  category?: string
  tags?: string
  comments?: string
  custom_fields?: CustomField[]
  urls?: string[]
  expires_at?: string | null
  /** Server 20.0.0+: icon assignment, see EntryIconWrite. Absent = the icon is untouched. */
  image_custom?: boolean
  image_index?: number
  image_name?: string
  /** Server 20.0.0+: one-time-code settings; absent = untouched, `null` = remove. */
  totp?: TotpWrite | null
  // Type-specific sub-objects
  credit_card?: CreditCardFields
  license?: LicenseFields
  identity?: IdentityFields
  information?: InformationFields
  banking?: BankingFields
  rdp?: RdpFields
  putty?: PuttyFields
  teamviewer?: TeamViewerFields
}

export interface MoveRequest {
  target: string | null
}

export interface CreateFolderRequest {
  name: string
  importance?: string
  category?: string
  tags?: string
  comments?: string
}

export interface UpdateFolderRequest {
  name?: string
  importance?: string
  category?: string
  tags?: string
  comments?: string
}
