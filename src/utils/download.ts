export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadTxt(content: string, filename: string = 'file.txt'): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  downloadBlob(blob, filename);
}