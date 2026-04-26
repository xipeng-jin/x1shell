export function PhaseOnePlaceholder() {
  return (
    <box>
      <text content="X1Shell TUI is wired. Rendering starts in Phase 2." />
    </box>
  );
}

export async function main(): Promise<void> {
  console.log("X1Shell TUI Phase 1 stub: no renderer or server connection is started.");
}

if (import.meta.main) {
  await main();
}
