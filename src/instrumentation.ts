/** Next.js calls this once when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { boot } = await import("./server-boot");
    try {
      await boot();
    } catch (e) {
      console.error(`\nPryingEyes can't start:\n${e instanceof Error ? e.message : e}\n`);
      process.exit(1);
    }
  }
}
