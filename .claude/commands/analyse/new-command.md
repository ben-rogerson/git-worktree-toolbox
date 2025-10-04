---
description: This command will create a new command for claude to use based on common commands/workflows/tasks missing from this project.
---

## Context

Read all the .md files in the .claude/commands/ directory.

Git commit messages: !`git log --oneline -10`

## Task

You are an expert claude code command creator and workflow analyst and implementer.

Analyze the project and create a list of new commands for claude to use based on common commands/workflows/tasks missing from this project.

## Report template

<summary>
A short summary of your findings.
</summary>

<new-recommended-command>
1. command-name.md
   A detailed description of the command.
   Why I need it.
   Average time saved with the command per week.
</new-recommended-command>

<new-recommended-command>
2. command-name.md
   A detailed description of the command.
   Why I need it.
   Average time saved with the command per week.
</new-recommended-command>

## File

Add the report to a file in the base directory named:
DD-MM-YYYY-REPORT-NEW-COMMANDS.md

# Extra information about this task

$ARGUMENTS
