/**
 * 部署期开关（构建时常量）
 * 走启动路径的判断不能依赖 fetch，所以放这里；
 * 运行时可热更的内容仍在 public/footer-links.json。
 */

/** 是否启用 ?txt= 蓝图链接加载 */
export const enableUrlLoad = true

/** 是否渲染页脚 */
export const showFooter = true
