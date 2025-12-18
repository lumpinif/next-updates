/**
 * UI-layer contracts for prompts/logging/spinners.
 *
 * This is where `@clack/prompts` will be wrapped so:
 * - cancellation is handled consistently
 * - output style is centralized
 * - flows stay testable (dependency injected)
 */

export type UiSession = {
  intro(message: string): void;
  outro(message: string): void;
};
