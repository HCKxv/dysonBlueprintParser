function showToast(text, duration = 3000) {
  let toast = document.getElementById('toast');

  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  clearTimeout(toast._hideTimer);
  // 只有当 toast 当前正在显示时，才需要强制重置动画
  if (toast.classList.contains('show')) {
    toast.style.transition = 'none';
    toast.classList.remove('show');
  }
  void toast.offsetWidth;
  // 恢复过渡，并在下一帧播放动画
  requestAnimationFrame(() => {
    toast.textContent = text;  // 更新文本
    toast.style.transition = '';
    toast.classList.add('show');
  });
  // 自动隐藏
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

export { showToast }
