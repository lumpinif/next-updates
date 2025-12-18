import {
  cancel,
  intro as clackIntro,
  outro as clackOutro,
  isCancel,
  select,
  spinner,
} from "@clack/prompts";

export type UiAction = "review-deps" | "exit";

export type ClackUi = {
  intro(message: string): void;
  outro(message: string): void;
  cancelAndExit(message: string): void;
  selectAction(): Promise<UiAction>;
  runSpinner(title: string, work: () => Promise<void>): Promise<void>;
};

export function createClackUi(): ClackUi {
  function intro(message: string): void {
    clackIntro(message);
  }

  function outro(message: string): void {
    clackOutro(message);
  }

  function cancelAndExit(message: string): void {
    cancel(message);
  }

  async function selectAction(): Promise<UiAction> {
    const action = await select({
      message: "What do you want to do?",
      options: [
        {
          value: "review-deps",
          label: "Review dependencies",
          hint: "coming soon",
        },
        {
          value: "exit",
          label: "Exit",
        },
      ],
    });

    if (isCancel(action)) {
      cancelAndExit("Operation cancelled.");
      return "exit";
    }

    return action;
  }

  async function runSpinner(
    title: string,
    work: () => Promise<void>
  ): Promise<void> {
    const s = spinner();
    s.start(title);
    try {
      await work();
      s.stop("Done");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      s.stop(message, 1);
      throw error;
    }
  }

  return {
    intro,
    outro,
    cancelAndExit,
    selectAction,
    runSpinner,
  };
}
