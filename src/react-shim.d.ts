declare module "react" {
  export interface CSSProperties {
    readonly [key: string]: string | number | undefined;
  }
  export type RefCallback<T> = (instance: T | null) => void;
  export interface RefObject<T> { current: T | null; }
  export type Ref<T> = RefCallback<T> | RefObject<T> | null;
  export interface MutableRefObject<T> { current: T; }
  export interface ReactElement {}
  export function createElement(type: string, props: Record<string, unknown> | null, ...children: unknown[]): ReactElement;
  export function forwardRef<T, P>(render: (props: P, ref: Ref<T>) => ReactElement | null): (props: P & { ref?: Ref<T> }) => ReactElement | null;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T>(initialValue: T): MutableRefObject<T>;
}
