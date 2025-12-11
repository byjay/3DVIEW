declare module '*.dxf' {
  const content: string;
  export default content;
}

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  glob<T = any>(
    pattern: string,
    options?: {
      as?: 'raw' | 'url';
      eager?: boolean;
      query?: string | Record<string, string>;
      import?: string;
    }
  ): Record<string, () => Promise<T>>;
}