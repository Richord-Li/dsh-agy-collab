import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(REPO_ROOT, 'agy-plugin');
const DST = path.join(os.homedir(), '.gemini', 'config', 'plugins', 'dsh-collab');

fs.mkdirSync(path.join(DST, 'assets'), { recursive: true });
fs.mkdirSync(path.join(DST, 'rules'), { recursive: true });
fs.mkdirSync(path.join(DST, 'skills', 'dsh-collab'), { recursive: true });

fs.copyFileSync(path.join(SRC, 'plugin.json'), path.join(DST, 'plugin.json'));
fs.copyFileSync(path.join(SRC, 'assets', 'logo.svg'), path.join(DST, 'assets', 'logo.svg'));
fs.copyFileSync(path.join(SRC, 'rules', 'AGENTS.md'), path.join(DST, 'rules', 'AGENTS.md'));
fs.copyFileSync(path.join(SRC, 'skills', 'dsh-collab', 'SKILL.md'), path.join(DST, 'skills', 'dsh-collab', 'SKILL.md'));

const serverPath = path.join(SRC, 'mcp', 'server.mjs').replace(/\\/g, '/');
const mcpConfig = {
  mcpServers: {
    'dsh-collab-hub': {
      command: 'node',
      args: [serverPath],
    },
  },
};
fs.writeFileSync(path.join(DST, 'mcp_config.json'), JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');

const userMeta = path.join(os.homedir(), '.dsh-agy-collab');
fs.mkdirSync(userMeta, { recursive: true });
fs.writeFileSync(path.join(userMeta, 'repo-path'), REPO_ROOT, 'utf8');

console.log(`[install-agy] installed Antigravity plugin manifest to ${DST}`);
console.log(`[install-agy] MCP server points to ${serverPath}`);
