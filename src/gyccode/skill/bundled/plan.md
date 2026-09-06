---
name: plan
description: Plan mode workflow - read-only planning and analysis
---

# Plan Mode

## Purpose
Plan mode is a **read-only** workflow phase for constructing well-formed plans before implementation begins.

## Usage
This skill is automatically activated when entering Plan Mode via the agent mode switch.

## Guidelines
- Analyze requirements thoroughly before planning
- Consider edge cases and error scenarios
- Break down complex tasks into actionable steps
- Use explore subagents for parallel investigation
- Present plans for user review before proceeding

## Workflow Integration
Plan Mode is the first phase in the standard workflow:
1. **Plan** (read-only) - Analyze and plan
2. **TDD** (execute) - Implement with tests
3. **Review** (verify) - Code review
4. **Debug** (fix) - Address issues
5. **Verify** (validate) - Confirm completeness

See also: compose:tdd, compose:review, compose:debug, compose:verify
