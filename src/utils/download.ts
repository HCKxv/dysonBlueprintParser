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

export type WellKnownDirectory =
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'music'
  | 'pictures'
  | 'videos';

export interface FilePickerType {
  description?: string;
  accept: Record<string, string[]>;
}

/** showSaveFilePicker 的签名（TS 的 lib.dom 还没收这个 API，这里只声明用得到的部分） */
type SaveFilePicker = (options?: {
  suggestedName?: string;
  startIn?: FileSystemHandle | WellKnownDirectory;
  types?: FilePickerType[];
}) => Promise<FileSystemFileHandle>;

export interface SaveAsOptions {
  suggestedName: string;
  startIn?: FileSystemHandle | WellKnownDirectory;
  types?: FilePickerType[];
}

export interface SaveAsResult {
  handle: FileSystemFileHandle | null;
  canceled: boolean;
  error: string;
}

/** 去掉末尾的扩展名 */
function withoutExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') || name;
}

/** 把文本写进文件句柄（必要时浏览器会弹一次授权） */
async function writeText(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

/** 另存为 */
export async function saveAsText(content: string, options: SaveAsOptions): Promise<SaveAsResult> {
  const pickSave = (window as any).showSaveFilePicker as SaveFilePicker | undefined;

  if (typeof pickSave !== 'function') {
    downloadTxt(content, withoutExtension(options.suggestedName));
    return { handle: null, canceled: false, error: '' };
  }

  try {
    const handle = await pickSave({
      suggestedName: options.suggestedName,
      startIn: options.startIn,
      types: options.types,
    });
    await writeText(handle, content);
    return { handle, canceled: false, error: '' };
  } catch (error) {
    // 用户取消不算失败
    if ((error as Error)?.name === 'AbortError') return { handle: null, canceled: true, error: '' };
    return { handle: null, canceled: false, error: (error as Error).message };
  }
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
