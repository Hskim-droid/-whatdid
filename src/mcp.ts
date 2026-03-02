import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, registerPrompts } from "./mcp-tools.js";

const server = new McpServer({
  name: "whatdid",
  version: "1.0.0",
});

registerTools(server);
registerPrompts(server);

const transport = new StdioServerTransport();
await server.connect(transport);
