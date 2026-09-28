// A node --test reporter for tests/run.mjs: one JSON line per skipped test
// ({ name, reason, file }), written to a file the runner reads to count the skips.
// A skip is reported as test:pass (or test:fail) with data.skip set.

export default async function* skipReporter(source) {
  for await (const event of source) {
    if ((event.type === "test:pass" || event.type === "test:fail") && event.data.skip !== undefined && event.data.skip !== false) {
      const reason = typeof event.data.skip === "string" ? event.data.skip : "(no reason given)";
      yield `${JSON.stringify({ name: event.data.name, reason, file: event.data.file || "" })}\n`;
    }
  }
}
