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

function generateBaseName(taskDescription: string, maxLength: number): string {
  const words = extractKeywords(taskDescription, {
    maxWords: 4,
    minWordLength: 2,
  });

  const baseName = words.join("-") || "task";

  // Truncate to maxLength if needed, but avoid trailing hyphens
  if (baseName.length > maxLength) {
    let truncated = baseName.substring(0, maxLength);
    // Remove trailing hyphen if present
    if (truncated.endsWith("-")) {
      truncated = truncated.slice(0, -1);
    }
    return truncated;
  }

  return baseName;
}

export function generateWorktreeName(taskDescription: string): string {
  // Max 20 chars total
  return generateBaseName(taskDescription, 20);
}

export function generateBranchName(taskDescription: string): string {
  // Max 20 chars total
  return generateBaseName(taskDescription, 20);
}
