/** A byte count for messages: "512 B", "32 KB", "64 MB" (binary units, rounded). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}
