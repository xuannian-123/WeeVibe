import Taro from '@tarojs/taro';
import { cardLayout, type ActivityCardModel } from './model';
export const ACTIVITY_SHARE_CANVAS = 'weevibe-activity-share-card';
/** Assert ownership before every native boundary and after every async continuation. */
export async function renderActivityCard(card: ActivityCardModel, assertCurrent: () => void, canvasId = ACTIVITY_SHARE_CANVAS) {
  const layout = cardLayout(card);
  await new Promise<void>(resolve => Taro.nextTick(resolve));
  assertCurrent();
  const context = Taro.createCanvasContext(canvasId);
  context.setFillStyle('#fffaf5'); context.fillRect(0, 0, layout.width, layout.height);
  context.setFillStyle('#e7f2e9'); context.fillRect(24, 20, 702, layout.height - 40);
  for (const line of layout.lines) {
    context.setFillStyle(line.color); context.setFontSize(line.size); context.fillText(line.text, 48, line.y);
  }
  await new Promise<void>((resolve, reject) => {
    // A platform draw callback that never arrives must not leave the UI permanently busy.
    const timer = setTimeout(() => reject(new Error('CANVAS_TIMEOUT')), 10000);
    try { assertCurrent(); context.draw(false, () => { clearTimeout(timer); resolve(); }); }
    catch (error) { clearTimeout(timer); reject(error); }
  });
  assertCurrent();
  const result = await Taro.canvasToTempFilePath({ canvasId, width: layout.width, height: layout.height, destWidth: layout.width, destHeight: layout.height, fileType: 'png' });
  assertCurrent();
  // Only the platform's generated local file is ever used. No remote QR/avatar/image URL input.
  if (typeof result.tempFilePath !== 'string' || /[\u0000-\u0020\\]/.test(result.tempFilePath) || !/^(wxfile:\/\/|https?:\/\/tmp\/|file:\/\/\/(?!\/)|\/(?!\/))/i.test(result.tempFilePath)) throw new Error('INVALID_CANVAS_FILE');
  return result.tempFilePath;
}
