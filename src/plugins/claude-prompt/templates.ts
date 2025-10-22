/**
 * Claude Prompt Templates
 *
 * Default prompt templates for the Claude CLI plugin.
 * Templates support variable substitution using {{variable}} syntax.
 */

export const DEFAULT_PROMPT_TEMPLATE = `
You are my coding assistant as I begin work in this new worktree:

Task: {{task_description}}
Branch: {{branch}}
Base branch: {{base_branch}}
Worktree path: {{worktree_path}}

Try not to ask me questions, just proceed with the following steps:
1. Analyze the codebase and related files for the task.
2. Determine the best implementation approach and identify potential issues.
3. Create an actionable checklist of the steps needed to complete the task.
4. Begin the task and complete it.
5. Respond with a concise summary of the task and the results.
`;

export interface TemplateVariables {
  task_description: string;
  branch: string;
  base_branch: string;
  worktree_path: string;
  worktree_name: string;
}

export function renderTemplate(
  template: string,
  variables: TemplateVariables,
): string {
  let rendered = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    rendered = rendered.replace(placeholder, value);
  }

  return rendered;
}
