import * as vscode from "vscode";
import { InstanceConfig, InstanceRecord, InstanceStore } from "./InstanceStore";

const GLOBAL_INSTANCES_KEY = "opencodeTui.instances.global";
const WORKSPACE_INSTANCES_KEY = "opencodeTui.instances.workspace";
const LEGACY_INSTANCE_KEYS = [
  "opencodeTui.instance",
  "opencodeTui.instanceConfig",
];
const DEFAULT_INSTANCE_ID = "default";
const DEFAULT_DEBOUNCE_MS = 500;

interface WorkspaceInstanceState {
  activeInstanceId?: string;
  instances: InstanceConfig[];
}

/**
 * Persists and restores instance configuration across VS Code sessions.
 */
export class InstanceRegistry implements vscode.Disposable {
  private readonly context: vscode.ExtensionContext;
  private readonly debounceMs: number;
  private persistTimer: NodeJS.Timeout | undefined;
  private changeSubscription: vscode.Disposable | undefined;

  constructor(
    context: vscode.ExtensionContext,
    debounceMs = DEFAULT_DEBOUNCE_MS,
  ) {
    this.context = context;
    this.debounceMs = debounceMs;
  }

  /**
   * Restores persisted instances into the given store and subscribes for auto-persist.
   */
  public hydrate(store: InstanceStore): void {
    const globalConfigs = this.readGlobalConfigs();
    const workspaceState = this.readWorkspaceState();
    const recordsById = new Map<string, InstanceConfig>();

    for (const config of globalConfigs) {
      recordsById.set(config.id, config);
    }

    for (const config of workspaceState.instances) {
      recordsById.set(config.id, config);
    }

    if (recordsById.size === 0) {
      const migrated = this.readLegacyDefaultConfig();
      if (migrated) {
        recordsById.set(migrated.id, migrated);
      }
    }

    for (const config of recordsById.values()) {
      store.upsert(this.toRecord(config));
    }

    if (
      workspaceState.activeInstanceId &&
      recordsById.has(workspaceState.activeInstanceId)
    ) {
      store.setActive(workspaceState.activeInstanceId);
    }

    this.changeSubscription?.dispose();
    this.changeSubscription = store.onDidChange(() => {
      this.schedulePersist(store);
    });
  }

  /**
   * Persists the current store snapshot to VS Code state stores.
   */
  public async persist(store: InstanceStore): Promise<void> {
    const allConfigs = this.toConfigs(store.getAll());
    const globalConfigs = allConfigs.filter((config) => !config.workspaceUri);
    const workspaceConfigs = allConfigs.filter((config) =>
      Boolean(config.workspaceUri),
    );
    const activeInstanceId = this.tryGetActiveId(store);

    await Promise.all([
      this.context.globalState.update(GLOBAL_INSTANCES_KEY, globalConfigs),
      this.context.workspaceState.update(WORKSPACE_INSTANCES_KEY, {
        activeInstanceId,
        instances: workspaceConfigs,
      } satisfies WorkspaceInstanceState),
    ]);
  }

  public dispose(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }

    this.changeSubscription?.dispose();
    this.changeSubscription = undefined;
  }

  private schedulePersist(store: InstanceStore): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persist(store).catch(() => {});
    }, this.debounceMs);
  }

  private readGlobalConfigs(): InstanceConfig[] {
    const value = this.context.globalState.get<unknown>(GLOBAL_INSTANCES_KEY);
    return this.toConfigArray(value);
  }

  private readWorkspaceState(): WorkspaceInstanceState {
    const value = this.context.workspaceState.get<unknown>(
      WORKSPACE_INSTANCES_KEY,
    );
    if (!value || typeof value !== "object") {
      return { instances: [] };
    }

    const state = value as Partial<WorkspaceInstanceState>;
    return {
      activeInstanceId:
        typeof state.activeInstanceId === "string"
          ? state.activeInstanceId
          : undefined,
      instances: this.toConfigArray(state.instances),
    };
  }

  private readLegacyDefaultConfig(): InstanceConfig | undefined {
    const fromStoredLegacy = this.readLegacyStoredConfig();
    if (fromStoredLegacy) {
      return {
        ...fromStoredLegacy,
        id: DEFAULT_INSTANCE_ID,
      };
    }

    const fromLegacySettings = this.readLegacySettingsConfig();
    if (!fromLegacySettings) {
      return undefined;
    }

    return {
      id: DEFAULT_INSTANCE_ID,
      ...fromLegacySettings,
    };
  }

  private readLegacyStoredConfig(): Partial<InstanceConfig> | undefined {
    for (const key of LEGACY_INSTANCE_KEYS) {
      const workspaceLegacy = this.context.workspaceState.get<unknown>(key);
      const workspaceConfig = this.toLegacyConfig(workspaceLegacy);
      if (workspaceConfig) {
        return workspaceConfig;
      }

      const globalLegacy = this.context.globalState.get<unknown>(key);
      const globalConfig = this.toLegacyConfig(globalLegacy);
      if (globalConfig) {
        return globalConfig;
      }
    }

    return undefined;
  }

  private readLegacySettingsConfig(): Partial<InstanceConfig> | undefined {
    const config = vscode.workspace.getConfiguration("opencodeTui");
    const commandInspection = config.inspect<string>("command");
    const enableHttpApiInspection = config.inspect<boolean>("enableHttpApi");

    const hasCustomCommand =
      commandInspection?.workspaceValue !== undefined ||
      commandInspection?.workspaceFolderValue !== undefined;
    const hasCustomHttpFlag =
      enableHttpApiInspection?.workspaceValue !== undefined ||
      enableHttpApiInspection?.workspaceFolderValue !== undefined;

    if (!hasCustomCommand && !hasCustomHttpFlag) {
      return undefined;
    }

    const migrated: Partial<InstanceConfig> = {};
    if (hasCustomCommand) {
      migrated.command = config.get<string>("command");
    }

    if (hasCustomHttpFlag) {
      migrated.enableHttpApi = config.get<boolean>("enableHttpApi", true);
    }

    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
    if (workspaceUri) {
      migrated.workspaceUri = workspaceUri;
    }

    return migrated;
  }

  private toConfigs(records: readonly InstanceRecord[]): InstanceConfig[] {
    return records
      .map((record) => this.toConfig(record.config))
      .filter((config): config is InstanceConfig => Boolean(config));
  }

  private toConfigArray(value: unknown): InstanceConfig[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => this.toConfig(entry))
      .filter((config): config is InstanceConfig => Boolean(config));
  }

  private toConfig(value: unknown): InstanceConfig | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const candidate = value as Partial<InstanceConfig>;
    if (typeof candidate.id !== "string" || candidate.id.length === 0) {
      return undefined;
    }

    return {
      id: candidate.id,
      workspaceUri:
        typeof candidate.workspaceUri === "string"
          ? candidate.workspaceUri
          : undefined,
      label: typeof candidate.label === "string" ? candidate.label : undefined,
      command:
        typeof candidate.command === "string" ? candidate.command : undefined,
      args: Array.isArray(candidate.args)
        ? candidate.args.filter((arg): arg is string => typeof arg === "string")
        : undefined,
      preferredPort:
        typeof candidate.preferredPort === "number"
          ? candidate.preferredPort
          : undefined,
      enableHttpApi:
        typeof candidate.enableHttpApi === "boolean"
          ? candidate.enableHttpApi
          : undefined,
    };
  }

  private toLegacyConfig(value: unknown): Partial<InstanceConfig> | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const candidate = value as Partial<InstanceConfig>;
    const config: Partial<InstanceConfig> = {
      workspaceUri:
        typeof candidate.workspaceUri === "string"
          ? candidate.workspaceUri
          : undefined,
      label: typeof candidate.label === "string" ? candidate.label : undefined,
      command:
        typeof candidate.command === "string" ? candidate.command : undefined,
      args: Array.isArray(candidate.args)
        ? candidate.args.filter((arg): arg is string => typeof arg === "string")
        : undefined,
      preferredPort:
        typeof candidate.preferredPort === "number"
          ? candidate.preferredPort
          : undefined,
      enableHttpApi:
        typeof candidate.enableHttpApi === "boolean"
          ? candidate.enableHttpApi
          : undefined,
    };

    const hasLegacyField =
      config.workspaceUri !== undefined ||
      config.label !== undefined ||
      config.command !== undefined ||
      config.args !== undefined ||
      config.preferredPort !== undefined ||
      config.enableHttpApi !== undefined;

    return hasLegacyField ? config : undefined;
  }

  private toRecord(config: InstanceConfig): InstanceRecord {
    return {
      config: {
        ...config,
        args: config.args ? [...config.args] : undefined,
      },
      runtime: {},
      state: "disconnected",
    };
  }

  private tryGetActiveId(store: InstanceStore): string | undefined {
    try {
      return store.getActive().config.id;
    } catch {
      return undefined;
    }
  }
}
