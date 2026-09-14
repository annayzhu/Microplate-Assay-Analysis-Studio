export function createScenarioReporter() {
  let current = "startup";
  return {
    begin(name) {
      current = name;
      process.stdout.write(`scenario: ${name}\n`);
    },
    enrich(error) {
      const message = error instanceof Error ? error.message : String(error);
      const wrapped = new Error(`[${current}] ${message}`);
      if (error instanceof Error && error.stack) wrapped.stack = `${wrapped.stack}\nCaused by:\n${error.stack}`;
      return wrapped;
    },
  };
}
