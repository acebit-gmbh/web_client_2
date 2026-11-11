import { beforeAll, afterAll } from 'vitest'

/*
  The time zone of this test process alone, for the describe block that calls
  it: Node reads TZ again whenever it changes, and Date and Intl follow it. The
  machine's own setting is never touched. The app's tsconfig carries no Node
  types, so process is reached through globalThis.
*/
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
  .process.env

export function inTimeZone(zone: string): void {
  let saved: string | undefined

  beforeAll(() => {
    saved = env.TZ
    env.TZ = zone
  })

  afterAll(() => {
    if (saved === undefined) delete env.TZ
    else env.TZ = saved
  })
}
