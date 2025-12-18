export type FlowResult = {
  ok: true;
};

export type FlowContext = {
  /**
   * Raw argv (after your CLI arg parsing).
   * This stays readonly so flows don't mutate process-level state.
   */
  argv: readonly string[];
};
