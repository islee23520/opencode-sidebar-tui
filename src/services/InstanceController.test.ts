import { describe, it, expect, beforeEach, vi } from "vitest";
import { InstanceController } from "./InstanceController";
import { TerminalManager } from "../terminals/TerminalManager";
import { InstanceStore, InstanceId, InstanceRecord } from "./InstanceStore";
import { PortManager } from "./PortManager";
import type * as vscodeTypes from "../test/mocks/vscode";

const vscode = await vi.importActual<typeof vscodeTypes>(
  "../test/mocks/vscode",
);

vi.mock("vscode", async () => {
  const actual = await vi.importActual("../test/mocks/vscode");
  return actual;
});

vi.mock("node-pty", async () => {
  const actual = await vi.importActual("../test/mocks/node-pty");
  return actual;
});

describe("InstanceController", () => {
  let controller: InstanceController;
  let terminalManager: TerminalManager;
  let instanceStore: InstanceStore;
  let portManager: PortManager;
  let outputChannel: vscodeTypes.OutputChannel;

  beforeEach(() => {
    vi.clearAllMocks();
    terminalManager = new TerminalManager();
    instanceStore = new InstanceStore();
    portManager = new PortManager();
    outputChannel = vscode.window.createOutputChannel("test");

    controller = new InstanceController(
      terminalManager,
      instanceStore,
      portManager,
      outputChannel,
    );
  });

  describe("Multi-Instance Collision Prevention", () => {
    it("should create instances on different ports", async () => {
      // Spawn first instance
      await controller.spawn("instance-1");
      const instance1 = instanceStore.get("instance-1");
      const port1 = instance1?.runtime.port;

      // Spawn second instance
      await controller.spawn("instance-2");
      const instance2 = instanceStore.get("instance-2");
      const port2 = instance2?.runtime.port;

      // Verify ports are different
      expect(port1).toBeDefined();
      expect(port2).toBeDefined();
      expect(port1).not.toBe(port2);
      expect(port1).toBeGreaterThanOrEqual(16384);
      expect(port2).toBeGreaterThanOrEqual(16384);
    });

    it("should create separate terminals for each instance", async () => {
      // Spawn two instances
      await controller.spawn("instance-1");
      await controller.spawn("instance-2");

      const instance1 = instanceStore.get("instance-1");
      const instance2 = instanceStore.get("instance-2");

      const terminalKey1 = instance1?.runtime.terminalKey;
      const terminalKey2 = instance2?.runtime.terminalKey;

      // Verify terminals are separate
      expect(terminalKey1).toBeDefined();
      expect(terminalKey2).toBeDefined();
      expect(terminalKey1).not.toBe(terminalKey2);

      // Verify both terminals exist in manager
      const terminal1 = terminalManager.getTerminal(terminalKey1!);
      const terminal2 = terminalManager.getTerminal(terminalKey2!);

      expect(terminal1).toBeDefined();
      expect(terminal2).toBeDefined();
      expect(terminal1?.id).toBe(terminalKey1);
      expect(terminal2?.id).toBe(terminalKey2);
    });

    it("should allocate non-colliding ports for multiple instances", async () => {
      const instanceCount = 5;
      const ports = new Set<number>();

      // Spawn multiple instances
      for (let i = 1; i <= instanceCount; i++) {
        await controller.spawn(`instance-${i}`);
        const instance = instanceStore.get(`instance-${i}`);
        const port = instance?.runtime.port;

        expect(port).toBeDefined();
        expect(ports.has(port!)).toBe(false); // No port collision
        ports.add(port!);
      }

      // Verify all ports are unique
      expect(ports.size).toBe(instanceCount);
    });

    it("should maintain independent state for each instance", async () => {
      await controller.spawn("instance-1");
      await controller.spawn("instance-2");

      const instance1 = instanceStore.get("instance-1");
      const instance2 = instanceStore.get("instance-2");

      // Both should have connected state
      expect(instance1?.state).toBe("connected");
      expect(instance2?.state).toBe("connected");

      // Kill first instance
      await controller.kill("instance-1");

      const instance1AfterKill = instanceStore.get("instance-1");
      const instance2AfterKill = instanceStore.get("instance-2");

      // First should be disconnected, second still connected
      expect(instance1AfterKill?.state).toBe("disconnected");
      expect(instance2AfterKill?.state).toBe("connected");
    });

    it("should reuse ports after terminal release", async () => {
      await controller.spawn("instance-1");
      const instance1 = instanceStore.get("instance-1");
      const port1 = instance1?.runtime.port;

      // Kill first instance
      await controller.kill("instance-1");

      // Spawn new instance
      await controller.spawn("instance-2");
      const instance2 = instanceStore.get("instance-2");
      const port2 = instance2?.runtime.port;

      // Port can be reused (may or may not be same port, but should not throw)
      expect(port1).toBeDefined();
      expect(port2).toBeDefined();
      expect(portManager.isPortAvailable(port1!)).toBe(true);
      expect(portManager.isPortAvailable(port2!)).toBe(false);
    });
  });

  describe("Active Switch Teardown", () => {
    it("should properly teardown on dispose", async () => {
      // Spawn multiple instances
      await controller.spawn("instance-1");
      await controller.spawn("instance-2");
      await controller.spawn("instance-3");

      const instance1 = instanceStore.get("instance-1");
      const instance2 = instanceStore.get("instance-2");
      const instance3 = instanceStore.get("instance-3");

      const terminalKey1 = instance1?.runtime.terminalKey!;
      const terminalKey2 = instance2?.runtime.terminalKey!;
      const terminalKey3 = instance3?.runtime.terminalKey!;

      // Verify all terminals exist before dispose
      expect(terminalManager.getTerminal(terminalKey1)).toBeDefined();
      expect(terminalManager.getTerminal(terminalKey2)).toBeDefined();
      expect(terminalManager.getTerminal(terminalKey3)).toBeDefined();

      // Dispose controller
      controller.dispose();

      // Verify all terminals are killed
      expect(terminalManager.getTerminal(terminalKey1)).toBeUndefined();
      expect(terminalManager.getTerminal(terminalKey2)).toBeUndefined();
      expect(terminalManager.getTerminal(terminalKey3)).toBeUndefined();

      // Verify all instances are disconnected
      const instance1AfterDispose = instanceStore.get("instance-1");
      const instance2AfterDispose = instanceStore.get("instance-2");
      const instance3AfterDispose = instanceStore.get("instance-3");

      expect(instance1AfterDispose?.state).toBe("disconnected");
      expect(instance2AfterDispose?.state).toBe("disconnected");
      expect(instance3AfterDispose?.state).toBe("disconnected");
    });

    it("should release all ports on dispose", async () => {
      await controller.spawn("instance-1");
      await controller.spawn("instance-2");

      const instance1 = instanceStore.get("instance-1");
      const instance2 = instanceStore.get("instance-2");

      const port1 = instance1?.runtime.port!;
      const port2 = instance2?.runtime.port!;

      // Verify ports are in use
      expect(portManager.isPortAvailable(port1)).toBe(false);
      expect(portManager.isPortAvailable(port2)).toBe(false);

      // Dispose controller
      controller.dispose();

      // Verify ports are released
      expect(portManager.isPortAvailable(port1)).toBe(true);
      expect(portManager.isPortAvailable(port2)).toBe(true);
    });

    it("should clear PIDs on dispose", async () => {
      await controller.spawn("instance-1");
      await controller.spawn("instance-2");

      // Dispose controller
      controller.dispose();

      // Verify PIDs are cleared
      const instance1 = instanceStore.get("instance-1");
      const instance2 = instanceStore.get("instance-2");

      expect(instance1?.runtime.pid).toBeUndefined();
      expect(instance2?.runtime.pid).toBeUndefined();
    });

    it("should not throw when disposing empty controller", () => {
      expect(() => controller.dispose()).not.toThrow();
    });

    it("should handle dispose with no active instances gracefully", () => {
      const emptyController = new InstanceController(
        terminalManager,
        instanceStore,
        portManager,
        outputChannel,
      );

      expect(() => emptyController.dispose()).not.toThrow();
    });
  });

  describe("Terminal-Port Mapping Integrity", () => {
    it("should maintain correct terminal-port mapping", async () => {
      await controller.spawn("instance-1");
      await controller.spawn("instance-2");

      const instance1 = instanceStore.get("instance-1");
      const instance2 = instanceStore.get("instance-2");

      const terminalKey1 = instance1?.runtime.terminalKey!;
      const terminalKey2 = instance2?.runtime.terminalKey!;

      const port1 = instance1?.runtime.port!;
      const port2 = instance2?.runtime.port!;

      // Verify PortManager mappings
      expect(portManager.getPortForTerminal(terminalKey1)).toBe(port1);
      expect(portManager.getPortForTerminal(terminalKey2)).toBe(port2);

      // Verify TerminalManager terminals
      const terminal1 = terminalManager.getTerminal(terminalKey1);
      const terminal2 = terminalManager.getTerminal(terminalKey2);

      expect(terminal1?.port).toBe(port1);
      expect(terminal2?.port).toBe(port2);
    });

    it("should clean up mappings when killing instance", async () => {
      await controller.spawn("instance-1");

      const instance1 = instanceStore.get("instance-1");
      const terminalKey1 = instance1?.runtime.terminalKey!;
      const port1 = instance1?.runtime.port!;

      // Verify mapping exists
      expect(portManager.getPortForTerminal(terminalKey1)).toBe(port1);

      // Kill instance
      await controller.kill("instance-1");

      // Verify mapping is cleaned
      expect(portManager.getPortForTerminal(terminalKey1)).toBeUndefined();
      expect(portManager.isPortAvailable(port1)).toBe(true);
    });
  });

  describe("Instance Lifecycle States", () => {
    it("should transition through correct states during spawn", async () => {
      const stateChanges: string[] = [];

      // Subscribe to state changes
      instanceStore.onDidChange((records) => {
        const instance = records.find((r) => r.config.id === "instance-1");
        if (instance) {
          stateChanges.push(instance.state);
        }
      });

      await controller.spawn("instance-1");

      // Should see spawning → connected
      expect(stateChanges).toContain("spawning");
      expect(stateChanges).toContain("connected");
    });

    it("should transition to stopping then disconnected on kill", async () => {
      await controller.spawn("instance-1");

      const stateChanges: string[] = [];

      // Subscribe to state changes
      instanceStore.onDidChange((records) => {
        const instance = records.find((r) => r.config.id === "instance-1");
        if (instance) {
          stateChanges.push(instance.state);
        }
      });

      await controller.kill("instance-1");

      // Should see stopping → disconnected
      expect(stateChanges).toContain("stopping");
      expect(stateChanges).toContain("disconnected");
    });
  });
});
