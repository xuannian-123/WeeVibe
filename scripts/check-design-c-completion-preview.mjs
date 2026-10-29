import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url), { chromium } = require('D:/CodexData/codex-home/tmp/fuyao-qa/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core');
const root = process.cwd(), out = resolve(root, 'outputs/design-c-completion-20261029');
await mkdir(resolve(out, 'screenshots'), { recursive: true });
const log = text => console.log(`[${new Date().toISOString()}] ${text}`);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, timeout: 15000, args: ['--allow-file-access-from-files'] });
const errors = [], externalRequests = [], layouts = [], interactions = {};
const cases = { settings: ['normal', 'signedout', 'busy'], privacy: ['normal', 'busy'], help: ['normal'], about: ['normal'], invitations: ['normal', 'empty', 'unread', 'busy', 'error', 'long'], number: ['normal', 'error', 'busy'], more: ['normal', 'empty', 'error'], logout: ['normal', 'busy', 'error'], login: ['normal', 'busy', 'error'], activities: ['normal', 'empty', 'error', 'busy'] };
const snap = async (page, name) => page.screenshot({ path: resolve(out, 'screenshots', `${name}.png`), animations: 'disabled', timeout: 10000 });
async function open(page, id, state = 'normal') { await page.goto(pathToFileURL(resolve(out, 'screen.html')).href + `?page=${id}&state=${state}`, { waitUntil: 'domcontentloaded' }); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(100); }
async function settled(page) { await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))); }
async function back(page) { await page.getByRole('button', { name: '返回', exact: true }).click(); await settled(page); }
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(String(error)));
  await page.route(/^https?:\/\//, async route => { externalRequests.push(route.request().url()); await route.abort(); });
  for (const width of [320, 375, 390, 430]) {
    log(`layout ${width}px`); await page.setViewportSize({ width, height: 844 });
    for (const [id, states] of Object.entries(cases)) for (const state of states) {
      await open(page, id, state);
      const layout = await page.evaluate(() => {
        const rect = selector => { const box = document.querySelector(selector)?.getBoundingClientRect(); return box ? { top: box.top, bottom: box.bottom, left: box.left, right: box.right } : null; };
        return { overflow: document.documentElement.scrollWidth > innerWidth + 1, brokenImages: [...document.images].filter(image => !image.complete || image.naturalWidth === 0).length, fontLoaded: document.fonts.check('800 20px WeeJakarta'), close: rect('.c-close'), menu: rect('.c-more-menu'), dialog: rect('.c-logout-dialog'), scroll: rect('.c-sheet-scroll'), footer: rect('.c-sheet-footer'), bottomNav: !!document.querySelector('.c-navigation') };
      });
      const outside = value => value && (value.left < -1 || value.right > width + 1 || value.top < 93 || value.bottom > 845);
      if (layout.overflow || layout.brokenImages || !layout.fontLoaded || layout.bottomNav || outside(layout.close) || outside(layout.menu) || outside(layout.dialog) || layout.scroll && layout.footer && layout.scroll.bottom > layout.footer.top + 1) throw Error(`layout ${id}/${state}/${width} ${JSON.stringify(layout)}`);
      layouts.push({ page: id, state, width, ...layout });
      if (width === 390 && (state === 'normal' || ['empty', 'error', 'busy', 'unread', 'signedout'].includes(state))) await snap(page, `${id}-${state}-390`);
    }
  }
  log('route and action checks'); await page.setViewportSize({ width: 390, height: 844 });
  for (const [title, id] of [['隐私与权限说明', 'privacy'], ['帮助与反馈', 'help'], ['关于 WeeVibe', 'about']]) {
    await open(page, 'settings'); await page.locator('.cs-utility-row').filter({ hasText: title }).click(); await settled(page);
    if ((await page.evaluate(() => window.reviewNavigation)).at(-1) !== id) throw Error(`Wrong support route ${id}`);
    await back(page); if ((await page.evaluate(() => window.reviewNavigation)).at(-1) !== 'settings') throw Error('Support return lost settings');
  }
  interactions.supportReturnsToSettings = true;
  await open(page, 'privacy'); await page.getByRole('button', { name: '管理微信权限', exact: true }).click();
  interactions.permissionsClearlyOffline = (await page.locator('[role="status"]').innerText()).includes('浏览器不调用微信权限');
  interactions.updatedActivityIdentityCopy = (await page.locator('.cs-body').innerText()).includes('活动昵称与动物头像') && !(await page.locator('.cs-body').innerText()).includes('参与者编号');
  for(const width of [320,390]){
    await page.setViewportSize({width,height:844});await open(page,'privacy');await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await settled(page);
    const tail=await page.evaluate(()=>{const header=document.querySelector('.cs-header').getBoundingClientRect(),button=document.querySelector('.cs-permissions').getBoundingClientRect(),hint=document.querySelector('.cs-hint').getBoundingClientRect();return{buttonTop:button.top,buttonBottom:button.bottom,hintBottom:hint.bottom,headerBottom:header.bottom,overflow:document.documentElement.scrollWidth>innerWidth+1,text:document.querySelector('.cs-body').innerText}});
    if(tail.buttonTop<tail.headerBottom-1||tail.buttonBottom>845||tail.hintBottom>845||tail.overflow||!tail.text.includes('个人预算与出发地点仅本人可见')||!tail.text.includes('也不会发送给 AI'))throw Error('Privacy tail/copy invalid '+JSON.stringify(tail));
    interactions['privacyTailVisible'+width]=true;await snap(page,'privacy-bottom-'+width);
  }
  await page.setViewportSize({width:390,height:844});
  for (const state of ['empty', 'unread', 'error', 'busy']) {
    await open(page, 'invitations', state); const text = await page.locator('.c-invitations-page').innerText();
    if ((state === 'empty') !== text.includes('暂无已保存邀请')) throw Error('Invitations conflates unavailable and empty');
  }
  interactions.invitationEmptyDistinctFromUnreadErrorBusy = true;
  await open(page, 'invitations', 'error'); await page.getByRole('button', { name: '重试', exact: true }).click();
  interactions.invitationRetry = await page.locator('.c-saved-invitation').count() === 2;
  await open(page, 'number'); interactions.emptyNumberDisabled = await page.getByRole('button', { name: '查看活动', exact: true }).isDisabled();
  await page.locator('.c-manual-input').fill('bad id'); await page.getByRole('button', { name: '查看活动', exact: true }).click();
  interactions.invalidNumberRetained = await page.locator('.c-manual-input').inputValue() === 'bad id' && (await page.locator('.c-manual-error').innerText()).includes('格式不正确');
  await page.locator('.c-manual-input').fill('sample-activity-1'); await page.getByRole('button', { name: '查看活动', exact: true }).click();
  interactions.numberOpensBoundaryWithoutEnrollment = (await page.locator('.boundary').innerText()).includes('不执行创建、报名、审批');
  await page.getByRole('button', { name: '返回上一页', exact: true }).click();
  interactions.numberBackKeepsInput = await page.locator('.c-manual-input').inputValue() === 'sample-activity-1';
  await open(page, 'more'); await page.getByRole('button', { name: '已保存邀请', exact: true }).click(); await back(page);
  interactions.moreReturnsToActivityList = (await page.evaluate(() => window.reviewNavigation)).at(-1) === 'activities';
  await page.getByRole('button', { name: '我参与的', exact: true }).click(); await settled(page); await page.getByRole('button', { name: '待审批', exact: true }).click(); await settled(page);
  // Wait for the adapter's queued native-tick restoration, rather than racing it with a synthetic user scroll.
  await page.waitForFunction(()=>window.reviewPendingTicks===0);await settled(page);
  await page.evaluate(() => window.scrollTo(0, 260));await page.waitForFunction(()=>window.reviewActivityBrowse?.groups.joined.scroll===260);
  const beforeNumber=await page.evaluate(()=>({position:scrollY,state:window.reviewActivityBrowse}));
  await page.getByRole('button', { name: '更多 ⋯', exact: true }).click(); await page.getByRole('button', { name: '通过编号打开', exact: true }).click(); await back(page);
  await page.waitForFunction(()=>window.reviewPendingTicks===0);await settled(page);
  const afterNumber=await page.evaluate(()=>({position:scrollY,state:window.reviewActivityBrowse}));
  interactions.activityFilterRestoredAfterNumber = (await page.locator('.c-activity-filters .c-selected').innerText()) === '待审批';
  interactions.activityScrollRestoredAfterNumber = Math.abs(afterNumber.position - 260) < 2;
  log('activity scroll '+JSON.stringify({before:beforeNumber,after:afterNumber}));
  const sticky = await page.locator('.c-activity-sticky').boundingBox(); interactions.activityControlsStayVisible = sticky.y >= 93 && sticky.y < 96;
  await open(page, 'logout'); await page.getByRole('button', { name: '取消', exact: true }).click(); interactions.logoutCancelKeepsSettings = await page.locator('.cs-settings').count() === 1 && await page.locator('.c-logout-dialog').count() === 0;
  await open(page, 'logout', 'busy'); interactions.logoutBusyLocked = await page.locator('.c-logout-actions button:not([disabled])').count() === 0;
  await open(page, 'login', 'busy'); interactions.loginBusyLocked = await page.getByRole('button', { name: '正在登录…', exact: true }).isDisabled();
  await page.getByRole('button', { name: '关闭弹层', exact: true }).click(); interactions.loginCloseKeepsSettings = await page.locator('.cs-settings').count() === 1 && await page.locator('.c-sheet').count() === 0;
  await open(page, 'login'); await page.getByRole('button', { name: '微信登录', exact: true }).last().click(); interactions.loginDoesNotFakeSession = (await page.locator('[role="status"]').innerText()).includes('不会建立真实微信会话');
  await page.goto(pathToFileURL(resolve(out, 'index.html')).href); await page.locator('textarea[data-note="settings"]').fill('AUTOMATED_REVIEW_TEST_ONLY'); await page.reload(); interactions.reviewNotesPersist = await page.locator('textarea[data-note="settings"]').inputValue() === 'AUTOMATED_REVIEW_TEST_ONLY';
  const downloadPromise = page.waitForEvent('download'); await page.locator('#export').click(); const download = await downloadPromise; const stream = await download.createReadStream(); let exported = ''; for await (const chunk of stream) exported += chunk;
  interactions.reviewNotesExport = JSON.parse(exported).notes.settings === 'AUTOMATED_REVIEW_TEST_ONLY';
  await page.locator('textarea[data-note="settings"]').fill(''); await page.evaluate(() => localStorage.removeItem('weevibe-c-completion-notes-20261029'));
  if (Object.values(interactions).some(value => value !== true) || errors.length || externalRequests.length) throw Error(JSON.stringify({ interactions, errors, externalRequests }));
  await writeFile(resolve(out, 'layout-checks.json'), JSON.stringify({ checks: layouts, errors, externalRequests, phone_verified: false }, null, 2));
  await writeFile(resolve(out, 'interaction-checks.json'), JSON.stringify({ checks: interactions, route_simulation: true, native_wechat_stack_verified: false, phone_verified: false }, null, 2));
  log(JSON.stringify({ layouts: layouts.length, interactions: Object.keys(interactions).length, errors, externalRequests }));
  const sharp = createRequire(resolve(root, 'apps/web/package.json'))('sharp');
  const boards = [['support-board', [['settings', '设置'], ['privacy', '隐私与权限说明'], ['help', '帮助与反馈'], ['about', '关于 WeeVibe']]], ['tools-board', [['invitations', '已保存邀请'], ['number', '通过编号打开'], ['more', '更多菜单']]], ['account-board', [['logout', '退出确认'], ['login', '微信登录'], ['activities', '活动列表与筛选']]]];
  for (const [name, entries] of boards) {
    const cell = 330, width = entries.length * cell, overlays = [];
    overlays.push({ input: Buffer.from(`<svg width="${width}" height="70" xmlns="http://www.w3.org/2000/svg"><text x="15" y="27" font-family="Microsoft YaHei,Arial" font-size="23" font-weight="700">WeeVibe · 外围补齐实际组件</text><text x="15" y="52" font-family="Microsoft YaHei,Arial" font-size="13" fill="#756c5d">全部为离线示例 · 真实微信登录、权限、返回与保存仍须小程序核对</text></svg>`), left: 0, top: 0 });
    for (let i = 0; i < entries.length; i++) { const [id, label] = entries[i]; overlays.push({ input: Buffer.from(`<svg width="312" height="43" xmlns="http://www.w3.org/2000/svg"><text x="4" y="28" font-family="Microsoft YaHei,Arial" font-size="18" font-weight="700">${i + 1} ${label}</text></svg>`), left: 9 + i * cell, top: 70 }); overlays.push({ input: await sharp(resolve(out, 'screenshots', `${id}-normal-390.png`)).resize(312).png().toBuffer(), left: 9 + i * cell, top: 113 }); }
    await sharp({ create: { width, height: 805, channels: 4, background: '#eae7df' } }).composite(overlays).png().toFile(resolve(out, name + '.png'));
  }
} catch (error) { log(`FAILED ${error.stack || error}`); throw error; } finally { await browser.close(); }
