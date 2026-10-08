// Framework request-scope shims (NOT network): Next's cookies() and after() only work inside a real request.
// Kept free of app imports so vi.mock factories can load it lazily:
//   vi.mock("next/headers", async () => (await import("./mocks")).headersMock());
//   vi.mock("next/server", async (orig) => (await import("./mocks")).serverMock(await orig()));
//   vi.mock("next/cache", async () => (await import("./mocks")).cacheMock());
const G = globalThis as { __e2eCookie?: string; __e2eAfter?: (() => unknown)[] };

export function headersMock() {
  return {
    cookies: async () => ({
      get: (name: string) => (name === "session" && G.__e2eCookie ? { name, value: G.__e2eCookie } : undefined),
      set: () => {}, delete: () => {},
    }),
    headers: async () => new Headers(),
  };
}

/** after(fn) queues fn; flushAfter() runs it the way Next would once the response is sent. */
export function serverMock(actual: unknown) {
  return {
    ...(actual as Record<string, unknown>),
    after: (task: unknown) => { (G.__e2eAfter ??= []).push(typeof task === "function" ? (task as () => unknown) : () => task); },
  };
}
export async function flushAfter() {
  const q = (G.__e2eAfter ??= []);
  while (q.length) await q.shift()!();
}

export function cacheMock() {
  return { revalidatePath: () => {}, revalidateTag: () => {} };
}
