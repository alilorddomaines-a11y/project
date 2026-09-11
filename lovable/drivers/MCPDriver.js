/**
 * lovable/drivers/MCPDriver.js
 * Lovable MCP driver implementation.
 * 
 * NOTE: As per architecture requirements, this driver remains DISABLED
 * until a verified Lovable MCP server is configured and tested in Antigravity.
 * It will not fake responses or pretend to be available.
 */

export class MCPDriver {
  constructor(config = {}) {
    this.name = 'LovableMCPDriver';
    this.serverName = config.serverName || 'lovable';
    this.enabled = false; // Explicitly disabled
  }

  async isAvailable() {
    // Verified during environment inspection: No Lovable MCP server is currently configured.
    return false;
  }

  async canContinue(workspace) {
    throw new Error('Lovable MCP Driver is disabled. Use EdgeBrowserDriver or configure Lovable MCP in mcp_config.json.');
  }

  async sendPrompt(prompt, context) {
    throw new Error('Lovable MCP Driver is disabled. Lovable MCP server is not active in Antigravity.');
  }

  async getProjectStatus() {
    return {
      driver: this.name,
      available: false,
      status: 'DISABLED',
      message: 'Configure Lovable MCP server in ~/.gemini/config/mcp_config.json to enable this driver.'
    };
  }
}
