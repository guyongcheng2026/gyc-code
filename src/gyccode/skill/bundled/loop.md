---
name: loop
description: Autonomous loop skill - keeps working until task is complete
---

# Autonomous Loop

When activated, this skill enables autonomous operation:

1. After completing a tool call, check if there are remaining steps
2. If yes, continue to the next step without waiting for user input
3. If no clear next step, report what was accomplished and exit loop
4. Maximum autonomous rounds: 10

## Exit Conditions
- All tasks in the plan are complete
- User interrupts
- 3 consecutive rounds with no progress (stuck detection)
- Error that cannot be recovered
