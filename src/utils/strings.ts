/**
 * String Utilities - String manipulation for worktree/branch names: generate worktree names, generate branch names from descriptions
 */

export function sanitizeForGit(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

export function extractKeywords(
  text: string,
  options: {
    maxWords?: number;
    minWordLength?: number;
    excludeWords?: string[];
  } = {},
): string[] {
  const {
    maxWords = 3,
    minWordLength = 2,
    excludeWords = ["the", "and", "for", "with", "help", "task"],
  } = options;

  return sanitizeForGit(text)
    .split(/\s+/)
    .filter(
      (word) => word.length > minWordLength && !excludeWords.includes(word),
    )
    .slice(0, maxWords);
}

export function generateWorktreeName(taskDescription: string): string {
  // Extract key words from task description
  const words = extractKeywords(taskDescription);

  // If no meaningful keywords, use a sanitized version of the task description
  let taskPart = words.join("-");
  if (!taskPart) {
    // Use the first few characters of the sanitized description, or "task" as fallback
    const sanitized = sanitizeForGit(taskDescription);
    taskPart = sanitized.length > 0 ? sanitized.substring(0, 10) : "task";
  }

  return `${taskPart}-${Date.now().toString().slice(-4)}`;
}

export function generateBranchName(taskDescription: string): string {
  const words = extractKeywords(taskDescription, {
    maxWords: 4,
    minWordLength: 2,
  });

  return `${words.join("-") || "task"}-${Date.now().toString().slice(-4)}`;
}
