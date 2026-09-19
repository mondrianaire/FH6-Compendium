---
name: agentdoc-mcp-install-workaround
description: "AgentDoc (jonverrier, C4 docs MCP server) is cloned untracked at <worktree>/AgentDoc; its transitive dep @jonverrier/assistant-common is PRIVATE on GitHub Packages, worked around by building it from the public AssistantCommon repo into vendor/*.tgz + an absolute-path npm override"
metadata: 
  node_type: memory
  type: project
  originSessionId: 5d2fda02-0b82-48f0-82e7-dbc1539f93e1
  modified: 2026-09-03T12:14:27.337Z
---

On 2026-09-03 Jett cloned https://github.com/jonverrier/AgentDoc (develop) into the lab worktree as `AgentDoc/` (untracked) to generate C4 documentation for the FH6 project. Install failed with `403 permission_denied: read_package` on `@jonverrier/assistant-common` even with a correct `read:packages` PAT: `prompt-repository` is public on GitHub Packages, `assistant-common` is not, despite the README saying both are.

Workaround that works: clone public `jonverrier/AssistantCommon`, `npm install --ignore-scripts && npm run build && npm pack`, copy the tarball to `AgentDoc/vendor/`, and add `"overrides": {"@jonverrier/assistant-common": "file:<ABSOLUTE path>/vendor/jonverrier-assistant-common-0.3.5.tgz"}` to AgentDoc's package.json. The path must be absolute: npm resolves relative `file:` overrides against the depending package, not the root. `NODE_AUTH_TOKEN` (read:packages) is still needed for any future `npm install` to fetch prompt-repository. Don't follow the README's "alias prompt-repository" tip: src imports `@jonverrier/prompt-repository` by its scoped name.

Registered in Claude Code at local scope as `agent-doc` (`node AgentDoc/dist/src/index.js <allowed-dir>`); the server needs at least one allowed directory argument or it exits with a usage line. It exposes prompts `generate_readme_files`, `generate_component_c4_diagrams`, `generate_rollup_c4_diagram` and Mermaid parse/preview tools.

**Why:** the failure looks like a token problem but isn't; rechecking scopes wastes time.
**How to apply:** if AgentDoc needs reinstalling, keep the vendor tarball + override, and set NODE_AUTH_TOKEN. Related: [[jett-github-first-research]], [[fh6-lab-runtime-layout]].
