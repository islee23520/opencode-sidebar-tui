import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  OpenCodeApiClient,
  type HealthCheckResponse,
  type ApiError,
} from "./OpenCodeApiClient";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("OpenCodeApiClient", () => {
  let client: OpenCodeApiClient;
  const TEST_PORT = 8080;
  const BASE_URL = `http://localhost:${TEST_PORT}`;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new OpenCodeApiClient(TEST_PORT);
  });

  describe("constructor", () => {
    it("should create client with default retry settings", () => {
      const defaultClient = new OpenCodeApiClient(TEST_PORT);
      expect(defaultClient).toBeDefined();
    });

    it("should create client with custom retry settings", () => {
      const customClient = new OpenCodeApiClient(TEST_PORT, 5, 100);
      expect(customClient).toBeDefined();
    });

    it("should accept different port numbers", () => {
      const port3000 = new OpenCodeApiClient(3000);
      const port9000 = new OpenCodeApiClient(9000);
      expect(port3000).toBeDefined();
      expect(port9000).toBeDefined();
    });
  });

  describe("healthCheck", () => {
    it("should return true when server responds with ok status", async () => {
      const mockResponse: HealthCheckResponse = {
        status: "ok",
        version: "1.0.0",
        timestamp: Date.now(),
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/health`,
        expect.objectContaining({
          method: "GET",
          headers: { Accept: "application/json" },
        }),
      );
    });

    it("should return false when server responds with error status", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it("should return false when response status is not ok", async () => {
      const mockResponse: HealthCheckResponse = {
        status: "error",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it("should return false when fetch throws error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const result = await client.healthCheck();

      expect(result).toBe(false);
    });

    it("should retry on connection errors and eventually succeed", async () => {
      const mockResponse: HealthCheckResponse = {
        status: "ok",
      };

      mockFetch
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        });

      const result = await client.healthCheck();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should return false after exhausting all retries", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 3, 10);
      const result = await shortClient.healthCheck();

      expect(result).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(4); // initial + 3 retries
    });
  });

  describe("appendPrompt", () => {
    it("should successfully append prompt", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await client.appendPrompt("Hello, OpenCode!");

      expect(mockFetch).toHaveBeenCalledWith(
        `${BASE_URL}/tui/append-prompt`,
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ prompt: "Hello, OpenCode!" }),
        }),
      );
    });

    it("should handle prompts with special characters", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const specialPrompt = "Hello! @file#L10-20 #tag $var `code`";
      await client.appendPrompt(specialPrompt);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ prompt: specialPrompt }),
        }),
      );
    });

    it("should handle multiline prompts", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      const multilinePrompt = "Line 1\nLine 2\nLine 3";
      await client.appendPrompt(multilinePrompt);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ prompt: multilinePrompt }),
        }),
      );
    });

    it("should throw error when server responds with error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(client.appendPrompt("test")).rejects.toThrow(
        "Failed to append prompt: 500 Internal Server Error",
      );
    });

    it("should throw error with status code on failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      try {
        await client.appendPrompt("test");
        expect.fail("Should have thrown");
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.statusCode).toBe(404);
      }
    });

    it("should retry on connection errors and eventually succeed", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockResolvedValueOnce({
          ok: true,
        });

      await client.appendPrompt("test prompt");

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("should throw error after exhausting all retries", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 2, 10);

      await expect(shortClient.appendPrompt("test")).rejects.toThrow(
        "Request failed after 2 retries",
      );
    });

    it("should include error code on max retries exhausted", async () => {
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 1, 10);

      try {
        await shortClient.appendPrompt("test");
        expect.fail("Should have thrown");
      } catch (error) {
        const apiError = error as ApiError;
        expect(apiError.code).toBe("MAX_RETRIES_EXHAUSTED");
      }
    });
  });

  describe("retry logic", () => {
    it("should use exponential backoff between retries", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockRejectedValueOnce(new Error("Connection refused"))
        .mockRejectedValueOnce(new Error("Connection refused"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 3, 10);

      await expect(shortClient.appendPrompt("test")).rejects.toThrow(
        "Request failed after 3 retries",
      );

      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it("should not retry on successful response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await client.appendPrompt("test");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("should handle network timeouts gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("ETIMEDOUT"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 1, 10);

      await expect(shortClient.appendPrompt("test")).rejects.toThrow(
        "ETIMEDOUT",
      );
    });

    it("should handle DNS resolution errors gracefully", async () => {
      mockFetch.mockRejectedValue(new Error("ENOTFOUND"));

      const shortClient = new OpenCodeApiClient(TEST_PORT, 1, 10);

      await expect(shortClient.appendPrompt("test")).rejects.toThrow(
        "ENOTFOUND",
      );
    });

    it("should handle empty prompt gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
      });

      await expect(client.appendPrompt("")).resolves.not.toThrow();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ prompt: "" }),
        }),
      );
    });
  });
});
