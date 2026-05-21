import { PcoClient } from "../../src/pco/client.js";
import { PatAuthProvider } from "../../src/pco/auth-provider.js";
import { createLogger } from "../../src/logger.js";
import type { AppConfig } from "../../src/config.js";
import type { ToolContext } from "../../src/tools/registry.js";

/**
 * Helper to create a test config with PAT auth
 */
export function createTestConfig(overrides?: Partial<AppConfig>): AppConfig {
  const base: AppConfig = {
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

  return { ...base, ...overrides };
}

/**
 * Mock MCP server for tool registration and testing
 */
export class MockMcpServer {
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

/**
 * Create a test tool context with mocked PcoClient
 */
export function createTestContext(config?: AppConfig): ToolContext {
  const testConfig = config ?? createTestConfig();
  const logger = createLogger("error");
  const authProvider = new PatAuthProvider("test-app-id", "test-secret");
  const pco = new PcoClient(authProvider, logger);

  return { pco, logger, config: testConfig };
}

/**
 * Helper to simulate successful JSON:API collection response
 */
export function mockJsonApiCollection(data: Array<{ id: string; attributes: Record<string, unknown> }>) {
  return {
    data: data.map(item => ({
      id: item.id,
      type: "MockResource",
      attributes: item.attributes,
    })),
  };
}

/**
 * Helper to simulate successful JSON:API single resource response
 */
export function mockJsonApiSingle(id: string, attributes: Record<string, unknown>) {
  return {
    data: {
      id,
      type: "MockResource",
      attributes,
    },
  };
}

/**
 * Helper to create a mock Response for fetch
 */
export function mockResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}