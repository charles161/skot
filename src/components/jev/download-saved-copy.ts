export function downloadSavedCopy(raw: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "skot-board-saved-copy.json";
  link.click();
  URL.revokeObjectURL(url);
}
