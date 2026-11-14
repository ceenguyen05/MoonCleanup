// Ambient declarations for tests only (environment-agnostic: no @types/node, no DOM lib).
declare module "*.bin?inline" {
  /** `data:application/octet-stream;base64,...` URL (Vite asset inline). */
  const dataUrl: string;
  export default dataUrl;
}

/** Base64 decoder present in Node 26 and every browser (not in the ES2024 lib). */
declare function atob(data: string): string;
