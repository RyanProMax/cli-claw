import fs from 'fs';
import path from 'path';

import { parseFrontmatter } from '../../skills/utils.js';

export const WORKFLOW_END = '__end__';

export type WorkflowNodeType =
  | 'role_task'
  | 'router'
  | 'parallel'
  | 'join'
  | 'final';

export type WorkflowPermissionMode = 'standard' | 'readonly';

export interface WorkflowRoleDefinition {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  skillIds: string[];
  permissionMode: WorkflowPermissionMode;
  instructions: string;
  sourcePath: string;
}

export interface WorkflowNodeDefinition {
  id: string;
  type: WorkflowNodeType;
  roleId?: string;
  prompt?: string;
}

export interface WorkflowEdgeDefinition {
  from: string;
  to: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  roles: string[];
  start: string;
  nodes: WorkflowNodeDefinition[];
  edges: WorkflowEdgeDefinition[];
  maxRetries: number;
  sourcePath: string;
}

export interface WorkflowDiscoveryOptions {
  workspaceRoot: string;
  knownTools: string[];
}

export interface WorkflowDiscoveryResult {
  workflows: WorkflowDefinition[];
  roles: Map<string, WorkflowRoleDefinition>;
  errors: string[];
}

export interface LoadedWorkflowDefinition {
  workflow: WorkflowDefinition | null;
  roles: Map<string, WorkflowRoleDefinition>;
  errors: string[];
}

const WORKFLOW_NODE_TYPES: WorkflowNodeType[] = [
  'role_task',
  'router',
  'parallel',
  'join',
  'final',
];

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeId(value: unknown): string {
  const normalized = normalizeText(value);
  return /^[a-z][a-z0-9_-]*$/i.test(normalized) ? normalized : '';
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter((item) => item.length > 0);
  }
  return normalizeText(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripFrontmatter(content: string): string {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return content.trim();
  const endIndex = lines.slice(1).findIndex((line) => line.trim() === '---');
  if (endIndex < 0) return content.trim();
  return lines
    .slice(endIndex + 2)
    .join('\n')
    .trim();
}

function safeReadJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function listFiles(root: string, extension: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function parsePermissionMode(value: unknown): WorkflowPermissionMode {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'readonly' ? 'readonly' : 'standard';
}

function parseRoleFile(
  filePath: string,
  knownTools: Set<string>,
): { role: WorkflowRoleDefinition | null; errors: string[] } {
  const idFromFile = path.basename(filePath, '.md');
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(content);
    const id = normalizeId(frontmatter.id) || normalizeId(idFromFile);
    if (!id) {
      return { role: null, errors: [`role ${idFromFile} has invalid id`] };
    }
    const allowedTools = normalizeList(frontmatter.allowedTools);
    const unknownTool = allowedTools.find((tool) => !knownTools.has(tool));
    if (unknownTool) {
      return {
        role: null,
        errors: [`role ${id} references unknown tool ${unknownTool}`],
      };
    }
    return {
      role: {
        id,
        name: normalizeText(frontmatter.name) || id,
        description: normalizeText(frontmatter.description),
        allowedTools,
        skillIds: normalizeList(frontmatter.skillIds),
        permissionMode: parsePermissionMode(frontmatter.permissionMode),
        instructions: stripFrontmatter(content),
        sourcePath: filePath,
      },
      errors: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      role: null,
      errors: [`role ${idFromFile} failed to load: ${message}`],
    };
  }
}

function parseWorkflowNode(raw: unknown): WorkflowNodeDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = normalizeId(record.id);
  const type = normalizeText(record.type);
  if (!id || !WORKFLOW_NODE_TYPES.includes(type as WorkflowNodeType))
    return null;
  return {
    id,
    type: type as WorkflowNodeType,
    roleId: normalizeId(record.roleId) || undefined,
    prompt: normalizeText(record.prompt) || undefined,
  };
}

function parseWorkflowEdge(raw: unknown): WorkflowEdgeDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const from = normalizeId(record.from);
  const toRaw = normalizeText(record.to);
  const to = toRaw === WORKFLOW_END ? WORKFLOW_END : normalizeId(toRaw);
  return from && to ? { from, to } : null;
}

function parseWorkflowFile(filePath: string): {
  workflow: WorkflowDefinition | null;
  errors: string[];
} {
  const idFromFile = path.basename(filePath, '.json');
  try {
    const raw = safeReadJson(filePath);
    if (!raw || typeof raw !== 'object') {
      return {
        workflow: null,
        errors: [`workflow ${idFromFile} must be an object`],
      };
    }
    const record = raw as Record<string, unknown>;
    const id = normalizeId(record.id) || normalizeId(idFromFile);
    const workflowLabel = id || idFromFile;
    const parseErrors: string[] = [];
    const nodes: WorkflowNodeDefinition[] = [];
    const edges: WorkflowEdgeDefinition[] = [];

    if (Array.isArray(record.nodes)) {
      record.nodes.forEach((rawNode, index) => {
        const node = parseWorkflowNode(rawNode);
        if (node) {
          nodes.push(node);
        } else {
          parseErrors.push(
            `workflow ${workflowLabel} contains invalid node at index ${index}`,
          );
        }
      });
    } else {
      parseErrors.push(`workflow ${workflowLabel} nodes must be an array`);
    }

    if (Array.isArray(record.edges)) {
      record.edges.forEach((rawEdge, index) => {
        const edge = parseWorkflowEdge(rawEdge);
        if (edge) {
          edges.push(edge);
        } else {
          parseErrors.push(
            `workflow ${workflowLabel} contains invalid edge at index ${index}`,
          );
        }
      });
    } else {
      parseErrors.push(`workflow ${workflowLabel} edges must be an array`);
    }

    const roles = normalizeList(record.roles);
    const start = normalizeId(record.start);
    const maxRetries = Number.isInteger(record.maxRetries)
      ? Number(record.maxRetries)
      : 1;
    const errors = [...parseErrors];

    if (!id) errors.push(`workflow ${idFromFile} has invalid id`);
    if (!start) errors.push(`workflow ${workflowLabel} has invalid start`);
    if (nodes.length === 0) {
      errors.push(`workflow ${workflowLabel} has no nodes`);
    }
    if (errors.length > 0) {
      return { workflow: null, errors: Array.from(new Set(errors)) };
    }

    return {
      workflow: {
        id,
        name: normalizeText(record.name) || id,
        description: normalizeText(record.description),
        roles,
        start,
        nodes,
        edges,
        maxRetries: Math.max(0, maxRetries),
        sourcePath: filePath,
      },
      errors: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      workflow: null,
      errors: [`workflow ${idFromFile} failed to load: ${message}`],
    };
  }
}

function validateWorkflow(
  workflow: WorkflowDefinition,
  roles: Map<string, WorkflowRoleDefinition>,
): string[] {
  const errors: string[] = [];
  const nodeIds = new Set(workflow.nodes.map((node) => node.id));
  const declaredRoles = new Set(workflow.roles);

  for (const roleId of workflow.roles) {
    if (!roles.has(roleId)) {
      errors.push(`workflow ${workflow.id} references missing role ${roleId}`);
    }
  }
  if (!nodeIds.has(workflow.start)) {
    errors.push(
      `workflow ${workflow.id} start node ${workflow.start} not found`,
    );
  }

  for (const node of workflow.nodes) {
    if (node.type === 'role_task') {
      if (!node.roleId) {
        errors.push(
          `workflow ${workflow.id} node ${node.id} is missing roleId`,
        );
      } else if (!roles.has(node.roleId)) {
        errors.push(
          `workflow ${workflow.id} references missing role ${node.roleId}`,
        );
      } else if (declaredRoles.size > 0 && !declaredRoles.has(node.roleId)) {
        errors.push(
          `workflow ${workflow.id} node ${node.id} uses undeclared role ${node.roleId}`,
        );
      }
    }
  }

  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(
        `workflow ${workflow.id} edge references missing from node ${edge.from}`,
      );
    }
    if (edge.to !== WORKFLOW_END && !nodeIds.has(edge.to)) {
      errors.push(
        `workflow ${workflow.id} edge references missing to node ${edge.to}`,
      );
    }
  }

  if (errors.length > 0) return Array.from(new Set(errors));

  const adjacency = new Map<string, string[]>();
  for (const nodeId of nodeIds) adjacency.set(nodeId, []);
  for (const edge of workflow.edges) {
    if (edge.to !== WORKFLOW_END) {
      adjacency.get(edge.from)?.push(edge.to);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  let hasCycle = false;
  const walk = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      hasCycle = true;
      return;
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) walk(next);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  walk(workflow.start);

  if (hasCycle) errors.push(`workflow ${workflow.id} contains a cycle`);
  for (const nodeId of nodeIds) {
    if (!visited.has(nodeId)) {
      errors.push(`workflow ${workflow.id} node ${nodeId} is unreachable`);
    }
  }

  return errors;
}

export function discoverWorkflowConfigs(
  options: WorkflowDiscoveryOptions,
): WorkflowDiscoveryResult {
  const knownTools = new Set(options.knownTools);
  const roleRoot = path.join(options.workspaceRoot, '.agents', 'agent-roles');
  const workflowRoot = path.join(options.workspaceRoot, '.agents', 'workflows');
  const errors: string[] = [];
  const roles = new Map<string, WorkflowRoleDefinition>();

  for (const rolePath of listFiles(roleRoot, '.md')) {
    const parsed = parseRoleFile(rolePath, knownTools);
    errors.push(...parsed.errors);
    if (parsed.role) roles.set(parsed.role.id, parsed.role);
  }

  const workflows: WorkflowDefinition[] = [];
  for (const workflowPath of listFiles(workflowRoot, '.json')) {
    const parsed = parseWorkflowFile(workflowPath);
    errors.push(...parsed.errors);
    if (!parsed.workflow) continue;
    const validationErrors = validateWorkflow(parsed.workflow, roles);
    errors.push(...validationErrors);
    if (validationErrors.length === 0) workflows.push(parsed.workflow);
  }

  return {
    workflows,
    roles,
    errors: Array.from(new Set(errors)),
  };
}

export function loadWorkflowDefinition(options: {
  workspaceRoot: string;
  workflowId: string;
  knownTools: string[];
}): LoadedWorkflowDefinition {
  const discovered = discoverWorkflowConfigs({
    workspaceRoot: options.workspaceRoot,
    knownTools: options.knownTools,
  });
  const workflow = discovered.workflows.find(
    (candidate) => candidate.id === options.workflowId,
  );
  if (!workflow) {
    return {
      workflow: null,
      roles: discovered.roles,
      errors: [
        ...discovered.errors,
        `workflow ${options.workflowId} not found`,
      ],
    };
  }
  return {
    workflow,
    roles: discovered.roles,
    errors: discovered.errors,
  };
}
