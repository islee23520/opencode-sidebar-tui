import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HealthPoller } from "./HealthPoller";
import { InstanceStore, InstanceRecord, InstanceId } from "./InstanceStore";
import { OpenCodeApiClientFactory } from "./OpenCodeApiClientFactory";
import type { OpenCodeApiClient } from "./OpenCodeApiClient";

describe("HealthPoller", () => {
  let store: InstanceStore;
  let mockClient: {
    healthCheck: ReturnType<typeof vi.fn>;
  };
  let clientFactory: OpenCodeApiClientFactory;
  let poller: HealthPoller;

  beforeEach(() => {
    vi.useFakeTimers();

    store = new InstanceStore();

    // Mock OpenCodeApiClient
    mockClient = {
      healthCheck: vi.fn(),
    };

    // Mock OpenCodeApiClientFactory
    clientFactory = {
      createClient: vi.fn(() => mockClient as unknown as OpenCodeApiClient),
    } as unknown as OpenCodeApiClientFactory;

    poller = new HealthPoller(store, clientFactory, 10_000);
  });

  afterEach(() => {
    poller.dispose();
    vi.useRealTimers();
  });

  describe("lifecycle", () => {
    it("should start polling on start()", () => {
      store.upsert({
        config: { id: "instance-1" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("instance-1");

      expect(vi.getTimerCount()).toBe(1);
    });

    it("should not start polling for unknown instance", () => {
      poller.start("non-existent");

      expect(vi.getTimerCount()).toBe(0);
    });

    it("should not start polling for skipped state: spawning", () => {
      store.upsert({
        config: { id: "instance-1" },
        runtime: { port: 4096 },
        state: "spawning",
      });

      poller.start("instance-1");

      expect(vi.getTimerCount()).toBe(0);
    });

    it("should not start polling for skipped state: stopping", () => {
      store.upsert({
        config: { id: "instance-1" },
        runtime: { port: 4096 },
        state: "stopping",
      });

      poller.start("instance-1");

      expect(vi.getTimerCount()).toBe(0);
    });

    it("should not start polling if already polling", () => {
      store.upsert({
        config: { id: "instance-1" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("instance-1");
      expect(vi.getTimerCount()).toBe(1);

      // Start again
      poller.start("instance-1");
      expect(vi.getTimerCount()).toBe(1); // Still just one timer
    });

    it("should stop polling on stop()", () => {
      store.upsert({
        config: { id: "instance-1" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("instance-1");
      expect(vi.getTimerCount()).toBe(1);

      poller.stop("instance-1");
      expect(vi.getTimerCount()).toBe(0);
    });

    it("should handle stop() for non-polling instance", () => {
      expect(() => poller.stop("non-existent")).not.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("should stop all polling on stopAll()", () => {
      store.upsert({
        config: { id: "instance-1" },
        runtime: { port: 4096 },
        state: "connected",
      });
      store.upsert({
        config: { id: "instance-2" },
        runtime: { port: 4097 },
        state: "connected",
      });

      poller.start("instance-1");
      poller.start("instance-2");
      expect(vi.getTimerCount()).toBe(2);

      poller.stopAll();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("should stop all polling on dispose()", () => {
      store.upsert({
        config: { id: "instance-1" },
        runtime: { port: 4096 },
        state: "connected",
      });
      store.upsert({
        config: { id: "instance-2" },
        runtime: { port: 4097 },
        state: "connected",
      });

      poller.start("instance-1");
      poller.start("instance-2");
      expect(vi.getTimerCount()).toBe(2);

      poller.dispose();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("should clear failure counts on stop()", () => {
      mockClient.healthCheck.mockResolvedValue(false);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // Trigger a failure
      vi.advanceTimersByTime(10_000);

      poller.stop("test");

      // Start again and verify failure count is reset
      mockClient.healthCheck.mockResolvedValue(true);
      poller.start("test");

      vi.advanceTimersByTime(10_000);

      // Should not transition to error (failure count was reset)
      const instance = store.get("test");
      expect(instance?.state).toBe("connected");
    });

    it("should clear all failure counts on stopAll()", () => {
      mockClient.healthCheck.mockResolvedValue(false);

      store.upsert({
        config: { id: "instance-1" },
        runtime: { port: 4096 },
        state: "connected",
      });
      store.upsert({
        config: { id: "instance-2" },
        runtime: { port: 4097 },
        state: "connected",
      });

      poller.start("instance-1");
      poller.start("instance-2");

      // Trigger failures
      vi.advanceTimersByTime(10_000);

      poller.stopAll();

      // Start again and verify failure counts are reset
      mockClient.healthCheck.mockResolvedValue(true);
      poller.start("instance-1");
      poller.start("instance-2");

      vi.advanceTimersByTime(10_000);

      // Should not transition to error (failure counts were reset)
      const instance1 = store.get("instance-1");
      const instance2 = store.get("instance-2");
      expect(instance1?.state).toBe("connected");
      expect(instance2?.state).toBe("connected");
    });
  });

  describe("health checks", () => {
    it("should call healthCheck on interval", async () => {
      mockClient.healthCheck.mockResolvedValue(true);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockClient.healthCheck).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockClient.healthCheck).toHaveBeenCalledTimes(2);
    });

    it("should not check health for instance without port", async () => {
      store.upsert({
        config: { id: "test" },
        runtime: {}, // No port
        state: "connected",
      });

      poller.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockClient.healthCheck).not.toHaveBeenCalled();
    });

    it("should not check health for removed instance", async () => {
      mockClient.healthCheck.mockResolvedValue(true);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // Remove instance before health check
      store.remove("test");

      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockClient.healthCheck).not.toHaveBeenCalled();
    });

    it("should create client with correct parameters", async () => {
      mockClient.healthCheck.mockResolvedValue(true);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 8080 },
        state: "connected",
      });

      poller.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      expect(clientFactory.createClient).toHaveBeenCalledWith("test", 8080);
    });

    it("should use custom interval when specified", async () => {
      mockClient.healthCheck.mockResolvedValue(true);

      const customPoller = new HealthPoller(
        store,
        clientFactory,
        5_000, // 5 seconds
      );

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      customPoller.start("test");

      await vi.advanceTimersByTimeAsync(5_000);

      expect(mockClient.healthCheck).toHaveBeenCalledTimes(1);

      customPoller.dispose();
    });
  });

  describe("state transitions - success to failure", () => {
    it("should transition connected->error after 3 consecutive failures", async () => {
      mockClient.healthCheck.mockResolvedValue(false);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // First failure
      await vi.advanceTimersByTimeAsync(10_000);
      let instance = store.get("test");
      expect(instance?.state).toBe("connected");
      expect(instance?.health?.ok).toBe(false);

      // Second failure
      await vi.advanceTimersByTimeAsync(10_000);
      instance = store.get("test");
      expect(instance?.state).toBe("connected");
      expect(instance?.health?.ok).toBe(false);

      // Third failure - should transition to error
      await vi.advanceTimersByTimeAsync(10_000);
      instance = store.get("test");
      expect(instance?.state).toBe("error");
      expect(instance?.error).toBe("Health check failed 3 consecutive times");
      expect(instance?.health?.ok).toBe(false);
    });

    it("should not transition to error on first failure", async () => {
      mockClient.healthCheck.mockResolvedValue(false);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      const instance = store.get("test");
      expect(instance?.state).toBe("connected");
      expect(instance?.health?.ok).toBe(false);
    });

    it("should not transition to error on second failure", async () => {
      mockClient.healthCheck.mockResolvedValue(false);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      await vi.advanceTimersByTimeAsync(20_000); // 2 failures

      const instance = store.get("test");
      expect(instance?.state).toBe("connected");
      expect(instance?.health?.ok).toBe(false);
    });

    it("should only transition connected->error (not other states)", async () => {
      mockClient.healthCheck.mockResolvedValue(false);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "disconnected",
      });

      poller.start("test");

      // 3 failures
      await vi.advanceTimersByTimeAsync(30_000);

      const instance = store.get("test");
      expect(instance?.state).toBe("disconnected"); // Should not change
      expect(instance?.health?.ok).toBe(false);
    });

    it("should reset failure count on successful health check", async () => {
      mockClient.healthCheck.mockResolvedValue(false);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // 2 failures
      await vi.advanceTimersByTimeAsync(20_000);

      // Success resets count
      mockClient.healthCheck.mockResolvedValue(true);
      await vi.advanceTimersByTimeAsync(10_000);

      // 2 more failures should not trigger error state
      mockClient.healthCheck.mockResolvedValue(false);
      await vi.advanceTimersByTimeAsync(20_000);

      const instance = store.get("test");
      expect(instance?.state).toBe("connected");
    });

    it("should handle health check errors as failures", async () => {
      mockClient.healthCheck.mockRejectedValue(new Error("Network error"));

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // 3 errors
      await vi.advanceTimersByTimeAsync(30_000);

      const instance = store.get("test");
      expect(instance?.state).toBe("error");
      expect(instance?.error).toBe("Health check failed 3 consecutive times");
    });
  });

  describe("state transitions - failure to success", () => {
    it("should transition error->connected on recovery", async () => {
      // Start in error state
      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "error",
        error: "Previous failure",
      });

      // Health check succeeds
      mockClient.healthCheck.mockResolvedValue(true);
      poller.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      const instance = store.get("test");
      expect(instance?.state).toBe("connected");
      expect(instance?.error).toBeUndefined();
      expect(instance?.health?.ok).toBe(true);
    });

    it("should clear error message on recovery", async () => {
      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "error",
        error: "Health check failed 3 consecutive times",
      });

      mockClient.healthCheck.mockResolvedValue(true);
      poller.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      const instance = store.get("test");
      expect(instance?.error).toBeUndefined();
    });

    it("should not transition other states on success", async () => {
      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "disconnected",
      });

      mockClient.healthCheck.mockResolvedValue(true);
      poller.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      const instance = store.get("test");
      expect(instance?.state).toBe("disconnected"); // Should not change
      expect(instance?.health?.ok).toBe(true);
    });

    it("should preserve existing health fields on success", async () => {
      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
        health: {
          ok: false,
          baseUrl: "http://localhost:4096",
          sessionTitle: "Test Session",
          model: "test-model",
          messageCount: 42,
          version: "1.0.0",
        },
      });

      mockClient.healthCheck.mockResolvedValue(true);
      poller.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      const instance = store.get("test");
      expect(instance?.health?.ok).toBe(true);
      expect(instance?.health?.baseUrl).toBe("http://localhost:4096");
      expect(instance?.health?.sessionTitle).toBe("Test Session");
      expect(instance?.health?.model).toBe("test-model");
      expect(instance?.health?.messageCount).toBe(42);
      expect(instance?.health?.version).toBe("1.0.0");
    });

    it("should preserve existing health fields on failure", async () => {
      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
        health: {
          ok: true,
          baseUrl: "http://localhost:4096",
          sessionTitle: "Test Session",
          model: "test-model",
          messageCount: 42,
          version: "1.0.0",
        },
      });

      mockClient.healthCheck.mockResolvedValue(false);
      poller.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      const instance = store.get("test");
      expect(instance?.health?.ok).toBe(false);
      expect(instance?.health?.baseUrl).toBe("http://localhost:4096");
      expect(instance?.health?.sessionTitle).toBe("Test Session");
      expect(instance?.health?.model).toBe("test-model");
      expect(instance?.health?.messageCount).toBe(42);
      expect(instance?.health?.version).toBe("1.0.0");
    });
  });

  describe("multiple instances", () => {
    it("should poll multiple instances independently", async () => {
      mockClient.healthCheck.mockResolvedValue(true);

      store.upsert({
        config: { id: "instance-1" },
        runtime: { port: 4096 },
        state: "connected",
      });
      store.upsert({
        config: { id: "instance-2" },
        runtime: { port: 4097 },
        state: "connected",
      });

      poller.start("instance-1");
      poller.start("instance-2");

      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockClient.healthCheck).toHaveBeenCalledTimes(2);
    });

    it("should track failure counts independently", async () => {
      store.upsert({
        config: { id: "instance-1" },
        runtime: { port: 4096 },
        state: "connected",
      });
      store.upsert({
        config: { id: "instance-2" },
        runtime: { port: 4097 },
        state: "connected",
      });

      // instance-1 fails, instance-2 succeeds
      let callCount = 0;
      mockClient.healthCheck.mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount % 2 === 0); // Even calls succeed
      });

      poller.start("instance-1");
      poller.start("instance-2");

      // 3 health checks - instance-1 fails 3 times, instance-2 succeeds 3 times
      await vi.advanceTimersByTimeAsync(30_000);

      const instance1 = store.get("instance-1");
      const instance2 = store.get("instance-2");

      expect(instance1?.state).toBe("error");
      expect(instance2?.state).toBe("connected");
    });

    it("should stop polling for specific instance", async () => {
      mockClient.healthCheck.mockResolvedValue(true);

      store.upsert({
        config: { id: "instance-1" },
        runtime: { port: 4096 },
        state: "connected",
      });
      store.upsert({
        config: { id: "instance-2" },
        runtime: { port: 4097 },
        state: "connected",
      });

      poller.start("instance-1");
      poller.start("instance-2");

      expect(vi.getTimerCount()).toBe(2);

      poller.stop("instance-1");

      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(10_000);

      // Only instance-2 should be checked
      expect(mockClient.healthCheck).toHaveBeenCalledTimes(1);
    });
  });

  describe("edge cases", () => {
    it("should handle instance update during polling", async () => {
      mockClient.healthCheck.mockResolvedValue(true);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // Update instance
      store.upsert({
        config: { id: "test", label: "Updated" },
        runtime: { port: 5000 },
        state: "connected",
      });

      await vi.advanceTimersByTimeAsync(10_000);

      // Should use new port
      expect(clientFactory.createClient).toHaveBeenCalledWith("test", 5000);
    });

    it("should handle state change to skipped state during polling", async () => {
      mockClient.healthCheck.mockResolvedValue(true);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // Change to skipped state
      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "spawning",
      });

      await vi.advanceTimersByTimeAsync(10_000);

      // Health check should still be called (poller doesn't stop automatically)
      expect(mockClient.healthCheck).toHaveBeenCalledTimes(1);
    });

    it("should handle health check returning promise rejection", async () => {
      mockClient.healthCheck.mockRejectedValue(new Error("Connection timeout"));

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // Should not throw
      await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow();

      const instance = store.get("test");
      expect(instance?.health?.ok).toBe(false);
    });

    it("should handle rapid start/stop cycles", () => {
      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      for (let i = 0; i < 10; i++) {
        poller.start("test");
        poller.stop("test");
      }

      expect(vi.getTimerCount()).toBe(0);
    });

    it("should handle dispose during active health check", async () => {
      mockClient.healthCheck.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(true), 1000);
          }),
      );

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // Advance to trigger health check
      const checkPromise = vi.advanceTimersByTimeAsync(10_000);

      // Dispose immediately
      poller.dispose();

      // Should not throw
      await expect(checkPromise).resolves.not.toThrow();

      expect(vi.getTimerCount()).toBe(0);
    });

    it("should handle instance with undefined health field", async () => {
      mockClient.healthCheck.mockResolvedValue(true);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
        // health is undefined
      });

      poller.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      const instance = store.get("test");
      expect(instance?.health?.ok).toBe(true);
    });

    it("should handle failure count exceeding threshold exactly", async () => {
      mockClient.healthCheck.mockResolvedValue(false);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // Exactly 3 failures
      await vi.advanceTimersByTimeAsync(30_000);

      const instance = store.get("test");
      expect(instance?.state).toBe("error");
    });

    it("should handle failure count exceeding threshold by many", async () => {
      mockClient.healthCheck.mockResolvedValue(false);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // 10 failures
      await vi.advanceTimersByTimeAsync(100_000);

      const instance = store.get("test");
      expect(instance?.state).toBe("error");
      // Should not transition multiple times
    });

    it("should continue polling after transitioning to error state", async () => {
      mockClient.healthCheck.mockResolvedValue(false);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // 3 failures -> error state
      await vi.advanceTimersByTimeAsync(30_000);

      const callCount = mockClient.healthCheck.mock.calls.length;

      // Continue polling
      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockClient.healthCheck.mock.calls.length).toBeGreaterThan(
        callCount,
      );
    });

    it("should recover from error state on next successful health check", async () => {
      mockClient.healthCheck.mockResolvedValue(false);

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      // 3 failures -> error state
      await vi.advanceTimersByTimeAsync(30_000);

      let instance = store.get("test");
      expect(instance?.state).toBe("error");

      // Next health check succeeds
      mockClient.healthCheck.mockResolvedValue(true);
      await vi.advanceTimersByTimeAsync(10_000);

      instance = store.get("test");
      expect(instance?.state).toBe("connected");
      expect(instance?.error).toBeUndefined();
    });
  });

  describe("output channel logging", () => {
    it("should log health check errors to output channel if provided", async () => {
      const mockOutputChannel = {
        appendLine: vi.fn(),
      };

      const pollerWithOutput = new HealthPoller(
        store,
        clientFactory,
        10_000,
        mockOutputChannel as any,
      );

      mockClient.healthCheck.mockRejectedValue(new Error("Connection refused"));

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      pollerWithOutput.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        "[HealthPoller] Health check failed for 'test': Connection refused",
      );

      pollerWithOutput.dispose();
    });

    it("should not throw if output channel is not provided", async () => {
      mockClient.healthCheck.mockRejectedValue(new Error("Connection refused"));

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      poller.start("test");

      await expect(vi.advanceTimersByTimeAsync(10_000)).resolves.not.toThrow();
    });

    it("should handle non-Error objects in catch block", async () => {
      const mockOutputChannel = {
        appendLine: vi.fn(),
      };

      const pollerWithOutput = new HealthPoller(
        store,
        clientFactory,
        10_000,
        mockOutputChannel as any,
      );

      mockClient.healthCheck.mockRejectedValue("string error");

      store.upsert({
        config: { id: "test" },
        runtime: { port: 4096 },
        state: "connected",
      });

      pollerWithOutput.start("test");

      await vi.advanceTimersByTimeAsync(10_000);

      expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
        "[HealthPoller] Health check failed for 'test': string error",
      );

      pollerWithOutput.dispose();
    });
  });
});
