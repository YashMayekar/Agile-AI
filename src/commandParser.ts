/* src/commandParser.ts
   Parses LLM command blocks into structured operations
*/

export interface RawCommand {
  operation?: string;
  location?: string;
  target?: string;
  content?: string;
  options?: string;
}

export interface ParsedCommand {
  operation: 'create' | 'read' | 'append' | 'update' | 'write' | 'delete' | 'rename' | 'copy' | 'mkdir' | 'readdir';
  location?: string;
  target?: string;
  content?: string;
  recursive?: boolean;
  overwrite?: boolean;
}

/** Extract command blocks wrapped in ##### only */
export function extractCommandBlocks(text: string): string[] {
  const blocks: string[] = [];
  
  // Match blocks between #####
  // const regex = /#####\s*([^#]+)\s*#####/g;
  const regex = /#####\s*([^#]+)\s*#####/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    blocks.push(match[1].trim());
  }
  
  return blocks;
}

/** Parse individual command block with new format */
export function parseCommandBlock(block: string): RawCommand {
  const raw: RawCommand = {};
  
  // Parse Location (~~?...~~? format)
  const locationMatch = block.match(/\/\/\?Location:\s*~~\?([^~]+)~~\?/);
  if (locationMatch) {
    raw.location = locationMatch[1].trim();
  }
  
  // Parse Operation
  const operationMatch = block.match(/\/\/\?Operation:\s*([^\n]+)/);
  if (operationMatch) {
    raw.operation = operationMatch[1].trim().toLowerCase();
  }
  
  // Parse Target (for rename/copy operations)
  const targetMatch = block.match(/\/\/\?Target:\s*~~\?([^~]+)~~\?/);
  if (targetMatch) {
    raw.target = targetMatch[1].trim();
  }
  
  // Parse Content with new format ($$?...$$?)
  const contentMatch = block.match(/\/\/\?Content:\s*\$\$\?([^$]+)\$\$\?/);
  if (contentMatch) {
    raw.content = contentMatch[1].trim();
  }
  
  // Parse Options
  const optionsMatch = block.match(/\/\/\?Options:\s*([^\n]+)/);
  if (optionsMatch) {
    raw.options = optionsMatch[1].trim();
  }
  
  return raw;
}

/** Normalize raw command with workspace root replacement */
export function normalizeRawCommand(raw: RawCommand, originalBlock: string): { parsed?: ParsedCommand; error?: string } {
  if (!raw.operation) {
    return { error: 'Missing operation' };
  }
  
  // Validate operation
  const validOperations = ['create', 'read', 'write', 'delete', 'rename', 'copy', 'mkdir', 'readdir'];
  if (!validOperations.includes(raw.operation)) {
    return { error: `Invalid operation: ${raw.operation}. Must be one of: ${validOperations.join(', ')}` };
  }
  
  const parsed: ParsedCommand = {
    operation: raw.operation as any,
    location: raw.location,
    target: raw.target,
    content: raw.content,
    recursive: false,
    overwrite: false
  };
  
  // Handle workspace root replacement in location and target
  if (parsed.location && parsed.location.includes('WorkspaceRoot')) {
    parsed.location = parsed.location.replace(/WorkspaceRoot/gi, 'workspace root');
  }
  
  if (parsed.target && parsed.target.includes('WorkspaceRoot')) {
    parsed.target = parsed.target.replace(/WorkspaceRoot/gi, 'workspace root');
  }
  
  // Parse options
  if (raw.options) {
    const opts = raw.options.toLowerCase().split(',').map(s => s.trim());
    parsed.recursive = opts.includes('recursive');
    parsed.overwrite = opts.includes('overwrite');
  }
  
  return { parsed };
}