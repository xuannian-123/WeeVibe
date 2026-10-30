import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),{chromium}=require(resolve('outputs/preview-tools/node_modules/playwright-core'));
const out=resolve('outputs/friend-share-20261030');await mkdir(resolve(out,'screenshots'),{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[],errors=[],external=[];
const base=pathToFileURL(resolve(out,'screen.html')).href;
async function pageFor(scenario,width=390){const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))external.push(r.url());});await page.goto(base+'?scenario='+scenario);await page.evaluate(()=>localStorage.clear());await page.reload();return page;}
function assert(value,label){if(!value)throw Error(label);checks.push(label);}
const shot=(page,name)=>page.screenshot({path:resolve(out,`screenshots/${name}-390.png`),fullPage:false});
async function complete(page){
  await page.locator('.gg-nickname-input').fill('示例朋友');await page.getByRole('button',{name:'下一步 →',exact:true}).click();
  await page.locator('.gp-private .ci-control').fill('示例朋友私人出发地');await page.locator('.gp-pair input').nth(1).fill('250');
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'下一步 →',exact:true}).click();
  await page.getByRole('button',{name:'AI 整理 ✦',exact:true}).click();await page.getByRole('button',{name:'继续按已填内容整理',exact:true}).click();await page.locator('.gp-certainty').waitFor();
}
try{
  for(const width of [320,390,486]){
    const page=await pageFor('visitor',width);await page.locator('.gg-nickname').waitFor();
    assert((await page.locator('.gp-invitation-context').textContent()).includes('周末一起轻松逛逛'),`${width}: invitation context before input`);
    assert(await page.evaluate(()=>window.reviewRequests.every(r=>r.method==='GET')),`${width}: opening share is read only`);
    assert(await page.locator('.gg-top,.gg-back').count()===0,`${width}: no legacy entry header`);
    if(width===390)await shot(page,'visitor');
    await complete(page);assert(await page.getByRole('button',{name:'确认参与并提交',exact:true}).count()===1,`${width}: explicit join and submit action`);
    assert(await page.evaluate(()=>!window.reviewRequests.some(r=>r.path.endsWith('/intake'))),`${width}: no membership before explicit submission`);
    const organize=await page.evaluate(()=>window.reviewRequests.find(r=>r.path.endsWith('/organize')));
    assert(!/私人出发地|budget_min|budget_max|origin|activity_nickname/.test(JSON.stringify(organize.body)),`${width}: private inputs excluded from AI`);
    if(width===390)await shot(page,'consent');
    await page.getByRole('button',{name:'确认参与并提交',exact:true}).click();await page.locator('.gh-hub').waitFor();
    assert((await page.locator('.gh-hub').textContent()).includes('大家的想法，放一起'),`${width}: submitted visitor enters content integration`);
    assert(!(await page.locator('.gh-hub').textContent()).includes('示例朋友私人出发地'),`${width}: own private fields excluded from integration`);
    assert(await page.getByRole('button',{name:'人齐了，生成安排！',exact:true}).count()===0,`${width}: peer has no generation action`);
    const saved=await page.evaluate(()=>window.reviewRequests.filter(r=>r.path.endsWith('/intake')));
    assert(saved.length===1&&saved[0].body.join_if_needed===true&&saved[0].body.expected_version===0,`${width}: single atomic first response request`);
    assert(saved[0].body.intake.private.budget_max===250,`${width}: private value retained for own server record`);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: integration fits viewport`);
    if(width===390)await shot(page,'member');await page.close();
  }
  {
    const page=await pageFor('created');await page.locator('.gf-card').first().waitFor();await page.locator('.gf-ai').click();await page.getByRole('button',{name:'发起活动',exact:true}).click();await page.locator('.gs-created').waitFor();await shot(page,'created');
    await page.getByRole('button',{name:'分享给朋友',exact:true}).click();const share=await page.evaluate(()=>window.reviewShares.at(-1));
    assert(share?.path==='/pages/gathering/index?id=33333333-3333-4333-8333-333333333333&entry=share','newly created page shares actual gathering id');assert(!/PRIVATE|private|budget|origin/.test(JSON.stringify(share)),'share metadata has no private preferences');
    await page.getByRole('button',{name:'看看大家的想法',exact:true}).click();await page.locator('.gh-hub').waitFor();assert((await page.locator('.gh-hub').textContent()).includes('大家的想法，放一起'),'success navigates to content integration');await page.close();
  }
  {
    const page=await pageFor('login');await page.getByRole('button',{name:'微信登录并继续',exact:true}).waitFor();await shot(page,'login');assert(await page.evaluate(()=>window.reviewRequests.length===0),'unauthenticated invitation does not request protected data');await page.getByRole('button',{name:'微信登录并继续',exact:true}).click();await page.locator('.gg-nickname').waitFor();assert(await page.evaluate(()=>window.reviewRequests[0].path==='/api/v1/gatherings/33333333-3333-4333-8333-333333333333'),'login retains exact invitation destination');await page.close();
  }
  {
    const page=await pageFor('member');await page.locator('.gh-hub').waitFor();assert(await page.locator('.gg-nickname').count()===0,'returning member does not repeat nickname intake');await page.close();
  }
  {
    const page=await pageFor('recovery');await page.locator('.gg-nickname').waitFor();await complete(page);await page.getByRole('button',{name:'确认参与并提交',exact:true}).click();await page.locator('.gh-recovery').waitFor();await shot(page,'recovery');
    const first=await page.evaluate(()=>window.reviewRequests.filter(r=>r.path.endsWith('/intake'))[0].body);await page.getByRole('button',{name:'沿用原请求核对保存',exact:true}).click();await page.locator('.gh-hub').waitFor();const requests=await page.evaluate(()=>window.reviewRequests.filter(r=>r.path.endsWith('/intake')));assert(requests.length===2&&JSON.stringify(requests[1].body)===JSON.stringify(first),'uncertain save retries exactly the original request');await page.close();
  }
  for(const scenario of ['missing','invalid']){const page=await pageFor(scenario);await page.locator('.ge-state').waitFor();await shot(page,scenario);assert(await page.locator('.gh-hub,.gg-nickname').count()===0,scenario+': no fake activity or membership');assert(await page.evaluate(()=>!window.reviewRequests.some(r=>r.method==='POST')),scenario+': no business writes');await page.close();}
  if(errors.length||external.length)throw Error(JSON.stringify({errors,external}));await writeFile(resolve(out,'checks.json'),JSON.stringify({checks,errors,external,sample_data_only:true},null,2));console.log(JSON.stringify({passed:checks.length,errors,external}));
}finally{await browser.close();}
