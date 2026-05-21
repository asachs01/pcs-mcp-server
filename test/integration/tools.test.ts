import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PcoClient } from "../../src/pco/client.js";
import { PatAuthProvider } from "../../src/pco/auth-provider.js";
import { createLogger } from "../../src/logger.js";
import type { AppConfig } from "../../src/config.js";
import type { ToolContext } from "../../src/tools/registry.js";
import infoTool from "../../src/tools/info.js";
import plansTool from "../../src/tools/plans.js";
import songsTool from "../../src/tools/songs.js";
import teamTool from "../../src/tools/team.js";

// Helper to create a test config with PAT auth
function createTestConfig(): AppConfig {
  return {
    transport: "stdio",
    port: 3000,
    logLevel: "error", // quiet logs during tests
    auth: {
      mode: "pat",
      appId: "test-app-id",
      secret: "test-secret",
    },
    defaults: {
      serviceTypeId: "12345",
    },
  };
}

// Mock MCP server for tool registration
class MockMcpServer {
  private tools: Map<string, Function> = new Map();
  public server: any; // Nested server object that elicitation logic expects

  constructor() {
    // Create the nested server structure that elicitation helpers expect
    this.server = {
      getClientCapabilities: () => ({}), // No elicitation support by default
    };
  }

  registerTool(name: string, definition: any, handler: Function) {
    this.tools.set(name, handler);
  }

  // Simulate calling a tool
  async callTool(name: string, args: any) {
    const handler = this.tools.get(name);
    if (!handler) {
      throw new Error(`Tool ${name} not found`);
    }
    return handler(args);
  }

  // Allow tests to customize client capabilities
  setClientCapabilities(capabilities: any) {
    this.server.getClientCapabilities = () => capabilities;
  }
}

describe("Tool Integration Tests", () => {
  let mockServer: MockMcpServer;
  let toolContext: ToolContext;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Mock the global fetch function that PcoClient uses
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    // Create test context
    const config = createTestConfig();
    const logger = createLogger("error");
    const authProvider = new PatAuthProvider("test-app-id", "test-secret");
    const pco = new PcoClient(authProvider, logger);

    toolContext = { pco, logger, config };
    mockServer = new MockMcpServer();

    // Register all tools
    infoTool.register(mockServer as any, toolContext);
    plansTool.register(mockServer as any, toolContext);
    songsTool.register(mockServer as any, toolContext);
    teamTool.register(mockServer as any, toolContext);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // Helper to simulate successful JSON:API response
  function mockJsonApiCollection(data: Array<{ id: string; attributes: Record<string, unknown> }>) {
    return {
      data: data.map(item => ({
        id: item.id,
        type: "MockResource",
        attributes: item.attributes,
      })),
    };
  }

  function mockJsonApiSingle(id: string, attributes: Record<string, unknown>) {
    return {
      data: {
        id,
        type: "MockResource",
        attributes,
      },
    };
  }

  describe("pcs_info tool", () => {
    it("should list service types and return formatted results", async () => {
      // Mock Planning Center API response for service types
      const mockResponse = mockJsonApiCollection([
        {
          id: "1",
          attributes: {
            name: "Sunday Service",
            sequence: 1,
          },
        },
        {
          id: "2",
          attributes: {
            name: "Wednesday Prayer",
            sequence: 2,
          },
        },
      ]);

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      // Call the tool through the mock server
      const result = await mockServer.callTool("pcs_info", {
        action: "list_service_types",
      });

      // Verify the response structure
      expect(result.content).toBeDefined();
      expect(result.content[0]?.type).toBe("text");

      if (result.content[0]?.type === "text") {
        const parsedResult = JSON.parse(result.content[0].text);
        expect(parsedResult).toHaveLength(2);
        expect(parsedResult[0]).toEqual({
          id: "1",
          name: "Sunday Service",
          sequence: 1,
        });
        expect(parsedResult[1]).toEqual({
          id: "2",
          name: "Wednesday Prayer",
          sequence: 2,
        });
      }

      // Verify fetch was called with correct URL
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.planningcenteronline.com/services/v2/service_types?per_page=100",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "Authorization": "Basic dGVzdC1hcHAtaWQ6dGVzdC1zZWNyZXQ=", // base64 of test-app-id:test-secret
          }),
        })
      );
    });

    it("should verify auth header is correctly set for PAT", async () => {
      const mockResponse = mockJsonApiCollection([]);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      await mockServer.callTool("pcs_info", {
        action: "list_service_types",
      });

      // Verify the Basic auth header with known credentials
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Authorization": "Basic dGVzdC1hcHAtaWQ6dGVzdC1zZWNyZXQ=",
          }),
        })
      );
    });
  });

  describe("plan_services tool", () => {
    it("should list plans with proper response structure", async () => {
      const mockResponse = mockJsonApiCollection([
        {
          id: "101",
          attributes: {
            title: "Easter Sunday",
            dates: "2024-03-31",
            sort_date: "2024-03-31T09:00:00Z",
            planning_center_url: "https://services.planningcenteronline.com/plans/101",
          },
        },
        {
          id: "102",
          attributes: {
            title: "Palm Sunday",
            dates: "2024-03-24",
            sort_date: "2024-03-24T09:00:00Z",
            planning_center_url: "https://services.planningcenteronline.com/plans/102",
          },
        },
      ]);

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const result = await mockServer.callTool("plan_services", {
        action: "list_plans",
      });

      expect(result.content).toBeDefined();
      if (result.content[0]?.type === "text") {
        const parsedResult = JSON.parse(result.content[0].text);
        expect(parsedResult).toHaveLength(2);
        expect(parsedResult[0]).toEqual({
          id: "101",
          title: "Easter Sunday",
          dates: "2024-03-31",
          sortDate: "2024-03-31T09:00:00Z",
          url: "https://services.planningcenteronline.com/plans/101",
        });
      }

      // Verify it used the default service type ID from config
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/services/v2/service_types/12345/plans"),
        expect.any(Object)
      );
    });

    it("should resolve natural language dates in filter parameters", async () => {
      const mockResponse = mockJsonApiCollection([]);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      await mockServer.callTool("plan_services", {
        action: "list_plans",
        startDate: "this Sunday", // Natural language date
      });

      // The exact resolved date depends on when the test runs, but we can verify
      // that fetch was called with a filter parameter
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/filter%5Bafter%5D=\d{4}-\d{2}-\d{2}/), // URL-encoded filter[after]=YYYY-MM-DD
        expect.any(Object)
      );
    });

    it("should handle service type elicitation when no default is set and multiple types exist", async () => {
      // Create config without default service type
      const configNoDefault = {
        ...createTestConfig(),
        defaults: {},
      };
      const logger = createLogger("error");
      const authProvider = new PatAuthProvider("test-app-id", "test-secret");
      const pco = new PcoClient(authProvider, logger);
      const contextNoDefault = { pco, logger, config: configNoDefault };
      const mockServerNoDefault = new MockMcpServer();
      plansTool.register(mockServerNoDefault as any, contextNoDefault);

      // Mock server capabilities to return empty (no elicitation support)
      // The MockMcpServer already returns {} by default, which simulates no elicitation support

      // Mock response for service types lookup
      const serviceTypesResponse = mockJsonApiCollection([
        { id: "1", attributes: { name: "Sunday Service" } },
        { id: "2", attributes: { name: "Wednesday Prayer" } },
      ]);

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(serviceTypesResponse), { status: 200 })
      );

      const result = await mockServerNoDefault.callTool("plan_services", {
        action: "list_plans",
      });

      // Should return an elicitation error since client doesn't support it
      expect(result.isError).toBe(true);
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("interactive prompts");
        expect(result.content[0].text).toContain("serviceTypeId");
      }
    });
  });

  describe("manage_songs tool", () => {
    it("should search songs and return formatted results", async () => {
      const mockResponse = mockJsonApiCollection([
        {
          id: "201",
          attributes: {
            title: "Amazing Grace",
            author: "John Newton",
            ccli_number: "22025",
            themes: ["Grace", "Redemption"],
          },
        },
        {
          id: "202",
          attributes: {
            title: "How Great Thou Art",
            author: "Carl Boberg",
            ccli_number: "14181",
            themes: ["Worship", "Praise"],
          },
        },
      ]);

      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      const result = await mockServer.callTool("manage_songs", {
        action: "search_songs",
        query: "Amazing",
      });

      expect(result.content).toBeDefined();
      if (result.content[0]?.type === "text") {
        const parsedResult = JSON.parse(result.content[0].text);
        expect(parsedResult).toHaveLength(2);
        expect(parsedResult[0]).toEqual({
          id: "201",
          title: "Amazing Grace",
          author: "John Newton",
          ccli_number: "22025",
          themes: ["Grace", "Redemption"],
        });
      }

      // Verify the search query was properly encoded
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("where%5Btitle%5D=Amazing"), // URL-encoded where[title]=Amazing
        expect.any(Object)
      );
    });
  });

  describe("manage_team tool", () => {
    it("should check availability and detect blockout conflicts", async () => {
      const personId = "301";
      const targetDate = "2024-04-15";

      // First call gets person info
      const personResponse = mockJsonApiSingle(personId, {
        name: "John Doe",
        first_name: "John",
        last_name: "Doe",
      });

      // Second call gets blockouts
      const blockoutsResponse = mockJsonApiCollection([
        {
          id: "401",
          attributes: {
            reason: "Family vacation",
            starts_at: "2024-04-10T00:00:00Z",
            ends_at: "2024-04-20T23:59:59Z",
          },
        },
      ]);

      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify(personResponse), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(blockoutsResponse), { status: 200 })
        );

      const result = await mockServer.callTool("manage_team", {
        action: "check_availability",
        personId,
        date: targetDate,
      });

      expect(result.content).toBeDefined();
      if (result.content[0]?.type === "text") {
        const parsedResult = JSON.parse(result.content[0].text);
        expect(parsedResult.personId).toBe(personId);
        expect(parsedResult.name).toBe("John Doe");
        expect(parsedResult.available).toBe(false); // Should conflict with vacation
        expect(parsedResult.conflictingBlockouts).toHaveLength(1);
        expect(parsedResult.conflictingBlockouts[0]).toEqual({
          id: "401",
          reason: "Family vacation",
          starts_at: "2024-04-10T00:00:00Z",
          ends_at: "2024-04-20T23:59:59Z",
        });
      }

      // Verify both API calls were made
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        `https://api.planningcenteronline.com/services/v2/people/${personId}`,
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`/services/v2/people/${personId}/blockouts`),
        expect.any(Object)
      );
    });

    it("should show person as available when no blockouts conflict", async () => {
      const personId = "302";
      const targetDate = "2024-04-15";

      // Person response
      const personResponse = mockJsonApiSingle(personId, {
        name: "Jane Smith",
      });

      // Empty blockouts (or non-conflicting ones)
      const blockoutsResponse = mockJsonApiCollection([]);

      mockFetch
        .mockResolvedValueOnce(
          new Response(JSON.stringify(personResponse), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify(blockoutsResponse), { status: 200 })
        );

      const result = await mockServer.callTool("manage_team", {
        action: "check_availability",
        personId,
        date: targetDate,
      });

      if (result.content[0]?.type === "text") {
        const parsedResult = JSON.parse(result.content[0].text);
        expect(parsedResult.available).toBe(true);
        expect(parsedResult.conflictingBlockouts).toHaveLength(0);
      }
    });
  });

  describe("Error handling", () => {
    it("should handle API errors gracefully", async () => {
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
        })
      );

      await expect(
        mockServer.callTool("pcs_info", {
          action: "list_service_types",
        })
      ).rejects.toThrow();
    });

    it("should validate required parameters", async () => {
      const result = await mockServer.callTool("manage_team", {
        action: "check_availability",
        // Missing required personId and date
      });

      expect(result.isError).toBe(true);
      if (result.content[0]?.type === "text") {
        expect(result.content[0].text).toContain("personId is required");
      }
    });
  });

  describe("Authentication headers", () => {
    it("should include correct Content-Type and Accept headers", async () => {
      const mockResponse = mockJsonApiCollection([]);
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify(mockResponse), { status: 200 })
      );

      await mockServer.callTool("pcs_info", {
        action: "list_service_types",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "Accept": "application/json",
          }),
        })
      );
    });
  });
});