/**
 * `miniprogram-automator` 的最小类型声明。
 *
 * 官方包只发布编译后的 JS（`out/*.js`），不带 `.d.ts`；而本工程 `tsconfig`
 * 是 `strict` + `include: ["**\/*.ts"]`，直接 import 会报「无声明文件」。
 *
 * 这里只声明 e2e 实际用到的方法，避免用 `any` 绕过类型检查。
 * 新增用法时请同步补声明，不要改成 `declare module ... : any`。
 */
declare module 'miniprogram-automator' {
  export interface AutomatorRect {
    left: number;
    top: number;
    right?: number;
    bottom?: number;
    width?: number;
    height?: number;
  }

  export interface AutomatorElement {
    $(selector: string): Promise<AutomatorElement | null>;
    $$(selector: string): Promise<AutomatorElement[]>;
    tap(): Promise<void>;
    text(): Promise<string>;
    attribute(name: string): Promise<string | null>;
    property(name: string): Promise<unknown>;
    offset(): Promise<AutomatorRect>;
    size(): Promise<{ width: number; height: number }>;
  }

  export interface AutomatorPage extends AutomatorElement {
    path: string;
    query: Record<string, string>;
    data(path?: string): Promise<Record<string, unknown>>;
    setData(patch: Record<string, unknown>): Promise<void>;
    callMethod(method: string, ...args: unknown[]): Promise<unknown>;
    waitFor(ms: number): Promise<void>;
    scrollTop(): Promise<number>;
  }

  export interface AutomatorMiniProgram {
    currentPage(): Promise<AutomatorPage>;
    reLaunch(url: string): Promise<AutomatorPage>;
    navigateTo(url: string): Promise<AutomatorPage>;
    redirectTo(url: string): Promise<AutomatorPage>;
    navigateBack(): Promise<void>;
    /**
     * 在 AppService 里执行函数。`any` 是必要的：该函数会被序列化后送到运行时，
     * 参数类型无法跨进程校验；调用方需自行保证可序列化。
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T>;
    systemInfo(): Promise<Record<string, unknown>>;
    screenshot(options?: { path?: string }): Promise<string | undefined>;
    pageScrollTo(scrollTop: number): Promise<void>;
    mockWxMethod(method: string, result: unknown): Promise<void>;
    restoreWxMethod(method: string): Promise<void>;
    disconnect(): Promise<void>;
  }

  const automator: {
    connect(options: { wsEndpoint: string }): Promise<AutomatorMiniProgram>;
    launch(options: Record<string, unknown>): Promise<AutomatorMiniProgram>;
  };

  export default automator;
}
