import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceRegistry } from "./InstanceRegistry";
import { InstanceStore } from "./InstanceStore";
import type * as vscodeTypes from "../test/mocks/vscode";

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

const GLOBAL_INSTANCES_KEY = "opencodeTui.instances.global";
const WORKSPACE_INSTANCES_KEY = "opencodeTui.instances.workspace";
const LEGACY_INSTANCE_KEY = "opencodeTui.instanceConfig";

function createContext(options?: {
  globalValues?: Record<string, unknown>;
  workspaceValues?: Record<string, unknown>;
}): {
  context: vscodeTypes.ExtensionContext;
  globalValues: Record<string, unknown>;
  workspaceValues: Record<string, unknown>;
} {
  const context = new vscode.ExtensionContext();
  const globalValues = { ...(options?.globalValues ?? {}) };
  const workspaceValues = { ...(options?.workspaceValues ?? {}) };

  vi.mocked(context.globalState.get).mockImplementation((key: string) => {
    return globalValues[key];
  });
  vi.mocked(context.workspaceState.get).mockImplementation((key: string) => {
    return workspaceValues[key];
  });

  vi.mocked(context.globalState.update).mockImplementation(
    async (key: string, value: unknown) => {
      globalValues[key] = value;
    },
  );
  vi.mocked(context.workspaceState.update).mockImplementation(
    async (key: string, value: unknown) => {
      workspaceValues[key] = value;
    },
  );

  return { context, globalValues, workspaceValues };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe("InstanceRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hydrates valid persisted configs, filters invalid data, and restores the active instance", () => {
    const { context } = createContext({
      globalValues: {
        [GLOBAL_INSTANCES_KEY]: [
          { id: "global-only", label: "Global Only" },
          { id: "shared", label: "Global Shared" },
          null,
          { label: "missing-id" },
        ],
      },
      workspaceValues: {
        [WORKSPACE_INSTANCES_KEY]: {
          activeInstanceId: "workspace-only",
          instances: [
            {
              id: "workspace-only",
              workspaceUri: "file:///workspace",
              label: "Workspace Only",
              args: ["--workspace", 123],
            },
            {
              id: "shared",
              workspaceUri: "file:///workspace",
              label: "Workspace Shared",
              preferredPort: 4100,
              enableHttpApi: true,
            },
            "invalid-entry",
          ],
        },
      },
    });
    const registry = new InstanceRegistry(context as any);
    const store = new InstanceStore();

    registry.hydrate(store);

    expect(store.getAll()).toHaveLength(3);
    expect(store.get("global-only")?.config).toMatchObject({
      id: "global-only",
      label: "Global Only",
    });
    expect(store.get("workspace-only")?.config).toMatchObject({
      id: "workspace-only",
      workspaceUri: "file:///workspace",
      label: "Workspace Only",
      args: ["--workspace"],
    });
    expect(store.get("shared")?.config).toMatchObject({
      id: "shared",
      workspaceUri: "file:///workspace",
      label: "Workspace Shared",
      preferredPort: 4100,
      enableHttpApi: true,
    });
    expect(store.getActive().config.id).toBe("workspace-only");
  });

  it("migrates legacy persisted config into the default instance when modern state is empty", () => {
    const { context } = createContext({
      globalValues: {
        [LEGACY_INSTANCE_KEY]: {
          workspaceUri: "file:///legacy",
          label: "Legacy Instance",
          args: ["--legacy", 99],
          selectedAiTool: "codex",
          preferredPort: 3200,
          enableHttpApi: true,
        },
      },
      workspaceValues: {
        [WORKSPACE_INSTANCES_KEY]: "not-an-object",
        opencodeTui: {},
      },
    });
    const registry = new InstanceRegistry(context as any);
    const store = new InstanceStore();

    registry.hydrate(store);

    expect(store.getAll()).toHaveLength(1);
    expect(store.get("default")?.config).toEqual({
      id: "default",
      workspaceUri: "file:///legacy",
      label: "Legacy Instance",
      args: ["--legacy"],
      selectedAiTool: "codex",
      preferredPort: 3200,
      enableHttpApi: true,
    });
    expect(store.getActive().config.id).toBe("default");
  });

  it("persists global and workspace instances into separate state buckets", async () => {
    const { context, globalValues, workspaceValues } = createContext();
    const registry = new InstanceRegistry(context as any);
    const store = new InstanceStore();

    store.upsert({
      config: { id: "global-instance", label: "Global" },
      runtime: { port: 1111 },
      state: "connected",
    });
    store.upsert({
      config: {
        id: "workspace-instance",
        workspaceUri: "file:///workspace",
        label: "Workspace",
        args: ["--workspace"],
      },
      runtime: { port: 2222 },
      state: "connected",
    });
    store.setActive("workspace-instance");

    await registry.persist(store);

    expect(context.globalState.update).toHaveBeenCalledWith(
      GLOBAL_INSTANCES_KEY,
      [{ id: "global-instance", label: "Global" }],
    );
    expect(context.workspaceState.update).toHaveBeenCalledWith(
      WORKSPACE_INSTANCES_KEY,
      {
        activeInstanceId: "workspace-instance",
        instances: [
          {
            id: "workspace-instance",
            workspaceUri: "file:///workspace",
            label: "Workspace",
            args: ["--workspace"],
          },
        ],
      },
    );
    expect(globalValues[GLOBAL_INSTANCES_KEY]).toEqual([
      { id: "global-instance", label: "Global" },
    ]);
    expect(workspaceValues[WORKSPACE_INSTANCES_KEY]).toEqual({
      activeInstanceId: "workspace-instance",
      instances: [
        {
          id: "workspace-instance",
          workspaceUri: "file:///workspace",
          label: "Workspace",
          args: ["--workspace"],
        },
      ],
    });
  });

  it("persists undefined active id when the store is empty", async () => {
    const { context } = createContext();
    const registry = new InstanceRegistry(context as any);

    await registry.persist(new InstanceStore());

    expect(context.globalState.update).toHaveBeenCalledWith(
      GLOBAL_INSTANCES_KEY,
      [],
    );
    expect(context.workspaceState.update).toHaveBeenCalledWith(
      WORKSPACE_INSTANCES_KEY,
      {
        activeInstanceId: undefined,
        instances: [],
      },
    );
  });

  it("coalesces rapid store changes into a single debounced persist", async () => {
    vi.useFakeTimers();

    const { context } = createContext();
    const registry = new InstanceRegistry(context as any, 25);
    const store = new InstanceStore();
    const persistSpy = vi
      .spyOn(registry, "persist")
      .mockResolvedValue(undefined);

    registry.hydrate(store);

    store.upsert({
      config: { id: "first" },
      runtime: {},
      state: "disconnected",
    });
    store.upsert({
      config: { id: "second" },
      runtime: {},
      state: "disconnected",
    });
    store.setActive("second");

    vi.advanceTimersByTime(24);
    expect(persistSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await flushMicrotasks();

    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledWith(store);
  });

  it("flushes a pending timer during dispose and unsubscribes from future store changes", async () => {
    vi.useFakeTimers();

    const { context } = createContext();
    const registry = new InstanceRegistry(context as any, 25);
    const store = new InstanceStore();
    const persistSpy = vi
      .spyOn(registry, "persist")
      .mockResolvedValue(undefined);

    registry.hydrate(store);

    store.upsert({
      config: { id: "first" },
      runtime: {},
      state: "disconnected",
    });

    registry.dispose();
    await flushMicrotasks();

    expect(persistSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(25);
    await flushMicrotasks();
    expect(persistSpy).toHaveBeenCalledTimes(1);

    store.upsert({
      config: { id: "second" },
      runtime: {},
      state: "disconnected",
    });
    vi.advanceTimersByTime(25);
    await flushMicrotasks();

    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows persist errors from the debounced timer callback", async () => {
    vi.useFakeTimers();

    const { context } = createContext();
    const registry = new InstanceRegistry(context as any, 25);
    const store = new InstanceStore();
    const persistSpy = vi
      .spyOn(registry, "persist")
      .mockRejectedValue(new Error("timer persist failed"));

    registry.hydrate(store);
    store.upsert({
      config: { id: "first" },
      runtime: {},
      state: "disconnected",
    });

    expect(() => {
      vi.advanceTimersByTime(25);
    }).not.toThrow();
    await flushMicrotasks();

    expect(persistSpy).toHaveBeenCalledTimes(1);
  });

  it("swallows persist errors when dispose flushes a pending timer", async () => {
    vi.useFakeTimers();

    const { context } = createContext();
    const registry = new InstanceRegistry(context as any, 25);
    const store = new InstanceStore();
    const persistSpy = vi
      .spyOn(registry, "persist")
      .mockRejectedValue(new Error("dispose persist failed"));

    registry.hydrate(store);
    store.upsert({
      config: { id: "first" },
      runtime: {},
      state: "disconnected",
    });

    expect(() => registry.dispose()).not.toThrow();
    await flushMicrotasks();

    expect(persistSpy).toHaveBeenCalledTimes(1);
  });
});
