import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('D:/CodexData/codex-home/tmp/fuyao-qa/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core');
const root=process.cwd(), out=resolve(root,'outputs/design-c-interview-20261029');
const progress=message=>console.log(`[${new Date().toISOString()}] ${message}`);
await mkdir(resolve(out,'screenshots'),{recursive:true});
progress('launch independent Chrome');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,timeout:15000,args:['--allow-file-access-from-files']});
progress('Chrome launched');
const errors=[],externalRequests=[],checks=[];
const samples=['周六下午两点以后有空','示例私人出发地','100到200','想吃火锅，唱歌','轻松一点，不喝酒'];
async function enter(page,ai='ok'){
  page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(15000);
  progress(`open controller ${page.viewportSize().width}px ai=${ai}`);
  await page.goto(pathToFileURL(resolve(out,'screen.html')).href+'?ai='+ai,{waitUntil:'domcontentloaded'});
  progress('controller loaded; choose interview');
  await page.getByRole('button',{name:'小橘头（AI问答）',exact:true}).click();
  await page.getByRole('button',{name:'下一步 →',exact:true}).click();
  await page.locator('.ci-composer-input').waitFor();
  progress('first question ready');
}
async function send(page,text){progress(`send ${text}`);await page.locator('.ci-composer-input').fill(text);await page.locator('.ci-send').click();await page.waitForTimeout(70)}
async function screenshot(page,name){progress(`capture ${name}`);await page.screenshot({path:resolve(out,'screenshots',name+'.png'),timeout:10000,animations:'disabled'});progress(`captured ${name}`)}
async function feedbackVisible(page,selector){
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const value=await page.locator(selector).evaluate(node=>{const rect=node.getBoundingClientRect(),scroll=document.querySelector('.ci-scroll').getBoundingClientRect();return{top:rect.top,bottom:rect.bottom,scrollTop:scroll.top,scrollBottom:scroll.bottom,visible:rect.top>=scroll.top-1&&rect.bottom<=scroll.bottom+1}});
  if(!value.visible)throw Error('Feedback outside scroll viewport '+JSON.stringify(value));
  return value;
}
try{
  for(const width of [320,375,390,430]){
    const page=await browser.newPage({viewport:{width,height:844}});
    page.on('pageerror',error=>errors.push(String(error)));
    page.on('request',request=>{if(/^https?:/.test(request.url()))externalRequests.push(request.url())});
    await enter(page);
    for(let index=0;index<5;index++){
      progress(`check question ${index+1} at ${width}px`);
      await page.waitForTimeout(90);
      const layout=await page.evaluate(()=>{
        const footer=document.querySelector('.ci-footer').getBoundingClientRect(),scroll=document.querySelector('.ci-scroll').getBoundingClientRect(),header=document.querySelector('.ci-header').getBoundingClientRect();
        return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth+1,footerBottom:footer.bottom,footerTop:footer.top,scrollBottom:scroll.bottom,headerTop:header.top,brokenImages:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).length};
      });
      if(layout.overflow||layout.brokenImages||layout.footerBottom>844.5||layout.scrollBottom>layout.footerTop+1)throw Error('Invalid layout '+JSON.stringify(layout));
      checks.push({width,index,...layout});
      if(width===390)await screenshot(page,'question-'+(index+1));
      if(index===2){await send(page,'两百左右');if(!await page.locator('.ci-notice').isVisible())throw Error('Ambiguous budget did not clarify');if(await page.locator('.ci-composer-input').inputValue()!=='两百左右')throw Error('Clarification lost input');if(width===390)await screenshot(page,'budget-clarification')}
      await send(page,samples[index]);
    }
    if((await page.evaluate(()=>window.reviewRequests.length))!==0)throw Error('Question answering called AI early');
    await page.getByRole('button',{name:'修改第3题回答',exact:true}).click();
    await send(page,'0元');
    // All questions are answered; editing keeps this question active, so its history button is absent.
    const inputValues=await page.locator('.ci-money-row input').evaluateAll(nodes=>nodes.map(node=>node.value));
    if(inputValues.length!==2||inputValues[1]!=='0')throw Error('Zero budget lost '+JSON.stringify(inputValues));
    await page.getByRole('button',{name:'愿意配合',exact:true}).click();
    const clearedBudget=await page.locator('.ci-money-row input').evaluateAll(nodes=>nodes.map(node=>node.value));
    if(clearedBudget.length!==2||clearedBudget.some(Boolean))throw Error('Cooperation did not clear budget '+JSON.stringify(clearedBudget));
    const privateText=await page.locator('.ci-answer-private').allTextContents();
    if(privateText.some(text=>text.includes('最高0元')))throw Error('Explicit cooperation retained previous budget');
    const summary=page.getByRole('button',{name:'查看整理结果 ↗',exact:true});
    if(await summary.count())await summary.click();else await page.getByRole('button',{name:'帮我整理',exact:true}).click();
    await page.getByText('哪些内容已经确定了？',{exact:true}).waitFor();
    const requests=await page.evaluate(()=>window.reviewRequests);
    if(requests.length!==1||/示例私人出发地|activity_nickname|budget_min|budget_max|origin|示例小林/.test(JSON.stringify(requests)))throw Error('Private/nickname leaked or duplicate request');
    if(width===390)await screenshot(page,'certainty-review');
    await page.locator('.ci-review .ci-back').click();
    await page.evaluate(()=>window.previewKeyboard(280));await page.waitForTimeout(90);
    const keyboardLayout=await page.evaluate(()=>{const footer=document.querySelector('.ci-footer').getBoundingClientRect();return{bottom:footer.bottom,scrollHeight:document.querySelector('.ci-scroll').clientHeight,overflow:document.documentElement.scrollWidth>innerWidth+1}});
    if(keyboardLayout.bottom>564.5||keyboardLayout.scrollHeight<30||keyboardLayout.overflow)throw Error('Keyboard footer overlap '+JSON.stringify(keyboardLayout));
    checks.push({width,keyboard:280,...keyboardLayout});
    checks.push({width,flow:true,fiveQuestions:true,ambiguousInputRetained:true,zeroBudgetRetained:true,cooperationClearsBudget:true,onlyPublicPayload:true,aiCallsBeforeExplicitSummary:0,aiCallsAfterExplicitSummary:requests.length});
    if(width===390)await screenshot(page,'keyboard');
    await page.close();
  }
  for(const ai of ['error','pending']){
    const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',error=>errors.push(String(error)));
    await enter(page,ai);for(const sample of samples)await send(page,sample);
    await page.getByRole('button',{name:'帮我整理',exact:true}).click();
    if(ai==='error'){
      await page.getByRole('button',{name:'继续按已填内容整理',exact:true}).waitFor();
      checks.push({ai,feedback:await feedbackVisible(page,'.ci-notice')});await screenshot(page,'ai-error');
      await page.getByRole('button',{name:'继续按已填内容整理',exact:true}).click();
      if(!await page.getByText('按你填写的内容整理，以下尚未经 AI 总结。',{exact:true}).isVisible())throw Error('Manual fallback mislabeled');
      await screenshot(page,'manual-fallback');
    }else{
      await page.getByText('正在整理你填写的公开想法…',{exact:true}).waitFor();
      if(await page.locator('.c-interview button:not([disabled])').count())throw Error('Busy state left controls enabled');
      checks.push({ai,feedback:await feedbackVisible(page,'.ci-busy')});await screenshot(page,'ai-waiting');
    }
    checks.push({ai,passed:true});await page.close();
  }
  if(errors.length||externalRequests.length)throw Error(JSON.stringify({errors,externalRequests}));
  await writeFile(resolve(out,'interaction-checks.json'),JSON.stringify({checks,errors,externalRequests,phoneVerified:false},null,2));
  console.log(JSON.stringify({checks:checks.length,errors:errors.length,externalRequests:externalRequests.length}));
}catch(error){progress(`FAILED: ${error.stack||error}`);throw error;}finally{await browser.close();progress('Chrome closed')}
