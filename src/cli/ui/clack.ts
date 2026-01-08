import {
  cancel,
  intro as clackIntro,
  outro as clackOutro,
  isCancel,
  type Option,
  select,
  spinner,
} from "@clack/prompts";

export type UiAction = "next-updates" | "exit";

export type SelectOption<TValue extends string> = Option<TValue>;

export type ClackUi = {
  intro(message: string): void;
  outro(message: string): void;
  cancelAndExit(message: string): void;
  selectAction(): Promise<UiAction>;
  selectOne<TValue extends string>(
    message: string,
    options: readonly SelectOption<TValue>[]
  ): Promise<TValue | null>;
  runSpinner<TResult>(
    title: string,
    work: () => Promise<TResult>
  ): Promise<TResult>;
  print(text: string): void;
};

export type CreateClackUiOptions = {
  stdout?: NodeJS.WriteStream;
};

export function createClackUi(options: CreateClackUiOptions = {}): ClackUi {
  const stdout = options.stdout ?? process.stdout;

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
          value: "next-updates",
          label: "Review dependencies",
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

  async function selectOne<TValue extends string>(
    message: string,
    selectOptions: readonly SelectOption<TValue>[]
  ): Promise<TValue | null> {
    const allowedValues = new Set<string>(
      selectOptions.map((option) => option.value)
    );
    const value = await select({
      message,
      options: [...selectOptions],
      initialValue: selectOptions[0]?.value,
    });

    if (isCancel(value)) {
      return null;
    }

    if (typeof value === "string" && allowedValues.has(value)) {
      return value as TValue;
    }

    throw new Error("Unexpected selection value");
  }

  async function runSpinner<TResult>(
    title: string,
    work: () => Promise<TResult>
  ): Promise<TResult> {
    const s = spinner();
    s.start(title);
    try {
      const result = await work();
      s.stop("Done");
      return result;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      s.stop(message, 1);
      throw error;
    }
  }

  function print(text: string): void {
    stdout.write(text);
    if (!text.endsWith("\n")) {
      stdout.write("\n");
    }
  }

  return {
    intro,
    outro,
    cancelAndExit,
    selectAction,
    selectOne,
    runSpinner,
    print,
  };
}
