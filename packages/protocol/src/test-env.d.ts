// Minimal Node typing for tests only (this package has `types: []`; the codecs themselves use no Node API).
declare module "node:v8" {
  export function getHeapStatistics(): { total_allocated_bytes: number };
}
