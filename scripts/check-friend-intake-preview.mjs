import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(resolve('outputs/preview-tools/node_modules/playwright-core'));
const out=resolve('outputs/friend-intake-20261030');await mkdir(resolve(out,'screenshots'),{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[],errors=[],external=[],base=pathToFileURL(resolve(out,'screen.html')).href;
function assert(value,label){if(!value)throw Error(label);checks.push(label);}
async function pageFor(scenario,width=390){const p=await browser.newPage({viewport:{width,height:844}});p.setDefaultTimeout(9000);p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});await p.goto(base+'?scenario='+scenario);await p.evaluate(()=>localStorage.clear());await p.reload();return p;}
const shot=(p,name)=>p.screenshot({path:resolve(out,`screenshots/${name}-390.png`),fullPage:['review','legacy','create-pending','details-match'].includes(name)});
const writes=p=>p.evaluate(()=>window.reviewRequests.filter(r=>r.method!=='GET'));
const field=(p,label)=>p.locator('.gg-field').filter({has:p.locator('.gg-label',{hasText:label})}).locator('input,textarea');
async function openForm(p){await p.locator('.gf-ai').click();await p.locator('.gg-nickname-input').fill('示例朋友');await p.getByRole('button',{name:'下一步 →',exact:true}).click();}
async function fillBasic(p){await field(p,'出游日期').fill('2030-11-08');await field(p,'什么时间有空').fill('下午两点之后');await p.locator('.gp-private .ci-control').fill('示例私密出发地');await field(p,'最低（元）').fill('1.');await field(p,'最高（元）').fill('250');}
async function finishForm(p,fallback=false){await p.getByRole('button',{name:'下一步 →',exact:true}).click();await p.getByRole('button',{name:'火锅／串串',exact:true}).click();await p.getByRole('button',{name:'下一步 →',exact:true}).click();await p.getByRole('button',{name:'轻松不赶场',exact:true}).click();await p.getByRole('button',{name:'下一步 →',exact:true}).click();await p.getByRole('button',{name:'整理偏好并预览',exact:true}).click();if(fallback)await p.getByRole('button',{name:'继续按已填内容整理',exact:true}).click();await p.locator('.gp-certainty').waitFor();}
function defaultDetails(d){return d.title===''&&d.date==='2030-11-08'&&d.start_time===''&&d.end_time===''&&d.place===''&&d.address===''&&d.minimum===null&&d.capacity===null&&d.fee.kind==='unknown'&&d.fee.amount===null&&d.confirmed_details.length===0;}
try{
 for(const width of [320,390,486]){
  const p=await pageFor('entry',width);await p.locator('.gf-ai').waitFor();
  assert(await p.locator('.gf-card').count()===1,`${width}: exactly one AI intake entry`);
  assert(!/活动安排|其他明细/.test(await p.locator('.gf-single-start').textContent()),`${width}: removed setup entries absent`);
  assert(await p.getByRole('button',{name:'发起活动',exact:true}).count()===0,`${width}: no premature create action`);
  assert((await writes(p)).length===0,`${width}: entry does not write`);
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: entry fits viewport`);
  if(width===390)await shot(p,'entry');
  await openForm(p);await fillBasic(p);
  if(width===390){await p.reload();await p.locator('.gf-ai').waitFor();assert((await p.locator('.gf-ai').textContent()).includes('待继续'),'unfinished draft is visible on entry');await p.locator('.gf-ai').click();await p.locator('.gp-form').waitFor();assert(await field(p,'最低（元）').inputValue()==='1.','unfinished decimal restored exactly');assert(await p.locator('.gp-private .ci-control').inputValue()==='示例私密出发地','private own origin restored');assert((await writes(p)).length===0,'draft restore does not auto organize or submit');await shot(p,'progress');}
  await finishForm(p);assert(await p.getByRole('button',{name:'发起活动',exact:true}).count()===0,`${width}: certainty step still does not publish`);
  const organize=(await writes(p)).find(r=>r.path.endsWith('/organize'));assert(!!organize&&!/示例私密|origin|budget|activity_nickname/.test(JSON.stringify(organize.body)),`${width}: organizer receives only public preference fields`);
  await p.getByRole('button',{name:'还都没确定',exact:true}).click();await p.locator('.gf-review').waitFor();
  assert(await p.getByRole('button',{name:'发起活动',exact:true}).count()===1,`${width}: explicit create only at final review`);
  assert(!/修改安排|修改明细|补充活动安排|修改其他明细/.test(await p.locator('.gf-review').textContent()),`${width}: final review has no deleted editors`);
  assert((await p.locator('.gf-review').textContent()).includes('示例私密出发地'),`${width}: own private preferences retained in own review`);
  if(width===390){await shot(p,'review');await p.getByRole('button',{name:'返回朋友出游',exact:true}).click();await p.locator('.gf-ai').click();await p.locator('.gf-review').waitFor();assert((await writes(p)).filter(r=>r.path.endsWith('/organize')).length===1,'return to completed review does not organize again');}
  await p.getByRole('button',{name:'发起活动',exact:true}).click();await p.locator('.gs-created').waitFor();
  const creates=(await writes(p)).filter(r=>r.path==='/api/v1/gatherings');assert(creates.length===1&&defaultDetails(creates[0].body.details),`${width}: fresh create uses aligned backend defaults and intake date`);
  assert(creates[0].body.intake.private.origin.label==='示例私密出发地'&&creates[0].body.intake.private.budget_max===250,`${width}: private own inputs saved separately`);
  assert(!/intake_progress|retired_details/.test(JSON.stringify(creates[0].body)),`${width}: local progress and retired fields excluded from DTO`);
  if(width===390)await shot(p,'created');
  await p.getByRole('button',{name:'分享给朋友',exact:true}).click();const share=await p.evaluate(()=>window.reviewShares.at(-1));assert(share.path.includes('id=33333333-3333-4333-8333-333333333333')&&!/budget|origin|示例私密/.test(JSON.stringify(share)),`${width}: sharing uses persisted ID without private data`);
  await p.getByRole('button',{name:'看看大家的想法',exact:true}).click();await p.locator('.gh-hub').waitFor();assert(!/示例私密出发地|补充活动安排|修改其他明细/.test(await p.locator('.gh-hub').textContent()),`${width}: created hub excludes private data and removed reentry`);await p.close();
 }
 {
  const p=await pageFor('entry');await p.locator('.gf-ai').click();await p.getByRole('button',{name:'小橘头（AI问答）',exact:true}).click();await p.locator('.gg-nickname-input').fill('示例小橘');await p.getByRole('button',{name:'下一步 →',exact:true}).click();await p.locator('.ci-composer-input').fill('2030-11-08 下午有空');await p.getByRole('button',{name:'发送回答',exact:true}).click();await p.locator('.ci-composer-input').fill('未发送的私密出发地');await p.reload();await p.locator('.gf-ai').click();await p.locator('.ci-composer-input').waitFor();assert(await p.locator('.ci-composer-input').inputValue()==='未发送的私密出发地','chat unsent composer restored');assert((await p.locator('.ci-visibility').textContent()).includes('仅本人可见'),'chat restores same private question');assert((await writes(p)).length===0,'restored chat does not invoke AI or submit');await shot(p,'chat');
  await p.locator('.ci-composer-input').fill('');for(let i=0;i<2;i++)await p.getByRole('button',{name:'愿意配合',exact:true}).click();for(let i=0;i<2;i++)await p.getByRole('button',{name:'先留待定',exact:true}).click();await p.getByRole('button',{name:'帮我整理',exact:true}).click();await p.locator('.ci-review').waitFor();assert(!(await writes(p)).some(r=>r.path==='/api/v1/gatherings'),'chat completes original questions without premature create');await p.getByRole('button',{name:'还都没确定',exact:true}).click();await p.locator('.gf-review').waitFor();assert((await p.locator('.gf-review').textContent()).includes('示例小橘'),'chat completes at same final review');await p.close();
 }
 {
  const p=await pageFor('legacy');await p.locator('.gf-ai').click();await p.locator('.gf-review').waitFor();assert((await p.locator('.gf-review').textContent()).includes('未带入本次发起的补充'),'legacy draft extras archived visibly');assert((await p.locator('.gf-review').textContent()).includes('以前单独填写的名称'),'legacy data remains reviewable');assert((await p.locator('.gf-review').textContent()).includes('原附加题示例回答'),'retired answers remain reviewable before creating');await shot(p,'legacy');await p.getByRole('button',{name:'发起活动',exact:true}).click();await p.locator('.gs-created').waitFor();const create=(await writes(p)).find(r=>r.path==='/api/v1/gatherings');assert(defaultDetails(create.body.details),'legacy draft extras never silently enter fresh create');assert(create.body.details.questions.length===0&&create.body.intake.answers.length===0,'retired questions and answers excluded together');await p.close();
 }
 {
  const p=await pageFor('create-pending');await p.locator('.gf-review').waitFor();assert((await writes(p)).length===0,'unknown prior create is not automatically resent');assert(await p.getByRole('button',{name:'修改偏好',exact:true}).isDisabled(),'prior unknown body is locked');await shot(p,'create-pending');await p.getByRole('button',{name:'沿用原请求核对并重试',exact:true}).click();await p.locator('.gs-created').waitFor();assert(await p.evaluate(()=>JSON.stringify(window.reviewRequests.find(r=>r.method==='POST').body)===JSON.stringify(window.originalPending)),'unknown create retry preserves exact original body and idempotency key');await p.close();
 }
 for(const scenario of ['details-match','details-changed']){
  const p=await pageFor(scenario);await p.getByText('先核对已有记录',{exact:true}).waitFor();assert((await writes(p)).length===0,scenario+': old detail recovery is read only');if(scenario==='details-match')await shot(p,'details-match');await p.getByRole('button',{name:scenario==='details-match'?'保留当前内容并完成核对':'保留当前内容，清除本机待核对记录',exact:true}).click();await p.locator('.gh-hub').waitFor();assert((await writes(p)).length===0,scenario+': clearing marker does not replay update');assert(await p.evaluate(()=>!Object.keys(localStorage).some(k=>k.includes('details-pending'))),scenario+': local pending record cleared');assert(!/补充活动安排|修改其他明细/.test(await p.locator('.gh-hub').textContent()),scenario+': no deleted management entry after recovery');await p.close();
 }
 for(const scenario of ['owner','member']){const p=await pageFor(scenario);await p.locator('.gh-hub').waitFor();assert(!/补充活动安排|修改其他明细/.test(await p.locator('.gh-hub').textContent()),scenario+': management has no removed configuration entrances');assert(!/PRIVATE_EXAMPLE/.test(await p.locator('.gh-hub').textContent()),scenario+': own private values absent from public hub');if(scenario==='owner')await shot(p,'owner');await p.close();}
 {
  const p=await pageFor('fallback');await openForm(p);await fillBasic(p);await finishForm(p,true);assert((await p.locator('.cr-summary').textContent()).includes('尚未经 AI 总结'),'failed AI requires explicit accurate manual fallback');assert(!(await writes(p)).some(r=>r.path==='/api/v1/gatherings'),'fallback still does not publish activity');await p.getByRole('button',{name:'还都没确定',exact:true}).click();await p.locator('.gf-review').waitFor();assert((await p.locator('.gf-review').textContent()).includes('示例私密出发地'),'fallback retains original own private input');await p.close();
 }
 if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));await writeFile(resolve(out,'checks.json'),JSON.stringify({checks,errors,external,sample_data_only:true},null,2));console.log(JSON.stringify({passed:checks.length,errors,external}));
}finally{await browser.close();}
