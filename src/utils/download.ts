function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function withTimestamp(base: string): string {
  return `${String(base || '').trim() || 'file'}-${timestamp()}`;
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();

  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadTxt(content: string, base: string = 'file'): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  saveBlob(blob, `${withTimestamp(base)}.txt`);
}

export function downloadCanvas(canvas: HTMLCanvasElement, base: string): Promise<void> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('无法生成图片'));
        return;
      }
      saveBlob(blob, `${withTimestamp(base)}.png`);
      resolve();
    }, 'image/png');
  });
}
