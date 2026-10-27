/** Preserve uncertainty: an unrecognized 404/405 is not proof that an earlier write never committed. */
export function unrecognizedResponseMessage(status: number): string {
  if (status === 404 || status === 405) return `当前服务返回无法识别的 HTTP ${status} 响应，请核对 API 地址、接口部署、请求方式及前后端版本。写入结果未确认，请保留输入和原请求核对，勿重复创建。`;
  return '服务响应无法验证，请保留输入和原请求，核对后端状态后重试；不会显示保存成功。';
}
