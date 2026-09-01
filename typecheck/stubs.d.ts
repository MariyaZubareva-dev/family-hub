declare module 'react' {
  export type FormEvent<T = Element> = any;
  export type ReactNode = any;
  export function useEffect(fn: any, deps?: any[]): void;
  export function useMemo<T>(fn: () => T, deps: any[]): T;
  export function useState<T>(initial: T): [T, (v: any) => void];
}
declare module 'react/jsx-runtime' { export const jsx:any; export const jsxs:any; export const Fragment:any; }
declare module '*.css' { const x: string; export default x; }
declare const importMetaEnv: any;
interface ImportMeta { env: any; }
interface ImportMetaConstructor {}
