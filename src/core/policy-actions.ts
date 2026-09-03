import { Schema } from "effect"

/**
 * Policy actions supported by core domains.
 * Each domain adds its actions to this union via module augmentation or direct export.
 * Kept in a separate file to avoid circular dependency initialization issues.
 */
export const PolicyActions = Schema.Literals(["provider.use"])