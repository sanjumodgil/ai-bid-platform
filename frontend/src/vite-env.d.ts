/// <reference types="react" />
/// <reference types="react-dom" />

// ── @hookform/resolvers ───────────────────────────────────────────
declare module '@hookform/resolvers/zod' {
  import type { Resolver } from 'react-hook-form'
  export function zodResolver(
    schema: any,
    schemaOptions?: any,
    factoryOptions?: any
  ): Resolver<any>
}

// ── Vite import.meta.env ──────────────────────────────────────────
interface ImportMetaEnv {
  readonly VITE_API_URL:     string
  readonly VITE_PORT:        string
  readonly VITE_APP_NAME:    string
  readonly VITE_APP_VERSION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
