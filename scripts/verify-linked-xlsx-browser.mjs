// Real Chrome checks against disposable localhost:4336 only. No Jira or main-app requests.
import path from 'node:path';
import os from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=await import(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'));
const out=path.resolve('docs/sdd/changes/archive/2026/LOCAL-20260924-02-linked-issue-status-bars/evidence/visual-20261111');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1}),checks=[],errors=[],external=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:4336/')){external.push(route.request().url());return route.abort();}return route.continue();});
const shot=name=>page.screenshot({path:path.join(out,`${name}.png`),fullPage:false});
const scroll=(left=0,top=0)=>page.locator('.timeline-scroll').evaluate((el,{left,top})=>{el.scrollLeft=left;el.scrollTop=top;},{left,top});
const row=key=>page.locator(`.related-row[data-issue-key="${key}"]`);
const filter=key=>page.getByLabel('Поиск по ключу или названию',{exact:true}).fill(key);
async function upload(name){
 await page.getByLabel('Поиск по ключу или названию',{exact:true}).fill('').catch(()=>{});
 await page.getByLabel('Источник истории файла',{exact:true}).selectOption('file');
 const response=await page.request.get(`http://127.0.0.1:4336/api/test/book/${name}`);assert.ok(response.ok());
 await page.getByLabel('Файл CSV или XLSX',{exact:true}).setInputFiles({name:`${name}.xlsx`,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:await response.body()});
 await page.getByLabel('Источник истории файла',{exact:true}).waitFor({state:'visible'});
 await page.waitForFunction(()=>!document.querySelector('select[aria-label="Источник истории файла"]').disabled);
 assert.equal(await page.locator('[role="alert"]').count(),0);
}
try{
 await page.goto('http://127.0.0.1:4336/',{waitUntil:'networkidle'});await upload('linked');
 await page.getByLabel('Источник длительностей',{exact:true}).selectOption('history');
 assert.equal(await page.locator('.epic-row').count(),3);assert.equal(await page.locator('.related-row').count(),0);
 await page.locator('.timeline-scroll').scrollIntoViewIfNeeded();await shot('01-collapsed');
 const root=page.getByRole('button',{name:'Раскрыть A-1',exact:true});await root.focus();await page.keyboard.press('Enter');
 assert.equal(await page.getByRole('button',{name:'Свернуть A-1',exact:true}).getAttribute('aria-expanded'),'true');
 assert.equal(await row('C-1').count(),1);assert.equal(await row('B-1').count(),1);
 const child=page.getByRole('button',{name:'Раскрыть B-1',exact:true});await child.focus();await page.keyboard.press('Space');
 assert.equal(await row('C-1').count(),2);assert.equal(await row('S-1').count(),0);assert.equal(await row('R-1').count(),0);assert.equal(await row('V-1').count(),1);
 assert.match(await row('V-1').textContent(),/через скрытый отклонённый эпик R-1/);
 assert.equal(await page.locator('.related-row [data-metric], .related-row .metric').count(),0);
 assert.ok(await page.locator('.epic-row [data-metric]').count()>0);
 assert.match(await row('D-1').textContent(),/не подтверждена|недоступна/);assert.match(await row('F-1').textContent(),/Создан после среза/);
 assert.match(await page.locator('.hierarchy-notice').allTextContents().then(a=>a.join(' ')),/цикл/i);
 assert.equal(await page.getByRole('button',{name:'Раскрыть Z-1',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Раскрыть W-1',exact:true}).click();await page.getByRole('button',{name:'Свернуть W-1',exact:true}).waitFor();assert.match(await page.locator('.hierarchy-notice').allTextContents().then(a=>a.join(' ')),/не подтверждён|не разреш|недоступ/i);
 await filter('A-1');
 const calendarStyle=await page.locator('.calendar-header').getAttribute('style');
 for(const [label,pixels] of [['День',26],['Неделя',8],['Месяц',3]]){
  await page.getByRole('button',{name:label,exact:true}).click();await scroll(250,0);
  const xs=await page.locator('.calendar-header,.epic-row .row-calendar,.related-row .row-calendar').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().x));assert.ok(xs.every(x=>Math.abs(x-xs[0])<1));
  const segments=row('C-1').first().locator('.related-segment');assert.equal(await segments.count(),2);
  assert.equal(await segments.nth(0).evaluate(e=>Number.parseFloat(e.style.width)),2*pixels);assert.equal(await segments.nth(1).evaluate(e=>Number.parseFloat(e.style.width)),4*pixels);
  assert.equal(await row('C-1').first().locator('.related-end').count(),1);
  assert.ok(await row('T-1').locator('.related-callout').count()>=2);
  const boxes=await row('T-1').locator('.related-callout').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}));
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(a.x+a.w<=b.x+1||b.x+b.w<=a.x+1||a.y+a.h<=b.y+1||b.y+b.h<=a.y+1,'Подписи не должны пересекаться');}
  await shot(`02-${label}`);
 }
 checks.push('Автономный импорт; свёрнутый вид, два уровня и общий ребёнок; скрытые исключения, неизвестность, пустая ветка и цикл; числовые ячейки только у корней; три масштаба и короткие/нулевые статусы');
 await page.getByRole('button',{name:'Свернуть B-1',exact:true}).focus();await page.keyboard.press('Space');assert.equal(await row('C-1').count(),1);
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SPAN');
 await page.getByRole('button',{name:'Раскрыть B-1',exact:true}).click();await filter('');
 await page.getByLabel('Сортировка',{exact:true}).selectOption('key');assert.equal(await row('C-1').count(),2);
 await page.getByLabel('Источник длительностей',{exact:true}).selectOption('excel');assert.equal(await page.locator('.related-row').count(),0);
 assert.equal(await page.locator('.epic-row[data-issue-key="A-1"] [data-metric="ttm"]').textContent(),'42,00');
 await shot('03-excel');await page.getByLabel('Источник длительностей',{exact:true}).selectOption('history');
 await page.getByRole('button',{name:'Свернуть A-1',exact:true}).click();assert.equal(await row('B-1').count(),0);
 await page.getByRole('button',{name:'Раскрыть A-1',exact:true}).click();assert.equal(await row('C-1').count(),1);
 checks.push('Enter/Space, aria-expanded, Tab; фильтр и сортировка при раскрытых строках; Excel-агрегат 42 сохранён; возврат к истории и сворачивание потомков');
 await page.setViewportSize({width:800,height:1000});await page.locator('.timeline-scroll').scrollIntoViewIfNeeded();await scroll(0,0);await shot('04-narrow-left');await scroll(500,180);await shot('05-narrow-calendar');
 assert.ok(await page.locator('.timeline-scroll').evaluate(e=>e.scrollWidth>e.clientWidth));
 await page.setViewportSize({width:1440,height:1050});
 const before=await (await page.request.get('http://127.0.0.1:4336/api/dataset')).json();
 const reopened=await (await page.request.post('http://127.0.0.1:4336/api/test/reopen',{headers:{'X-Local-Request':'1'}})).json();
 assert.equal(reopened.unchanged,true);assert.deepEqual(reopened.dataset,before.dataset);assert.equal(reopened.jiraCalls,0);
 await page.reload({waitUntil:'networkidle'});await page.getByLabel('Источник длительностей',{exact:true}).selectOption('history');await page.getByRole('button',{name:'Раскрыть A-1',exact:true}).click();assert.equal(await row('C-1').count(),1);
 checks.push('Узкое окно 800px и прокрутка; новый экземпляр сервиса восстанавливает тот же кэш/срез без сети');
 await upload('paged');await page.getByLabel('Источник длительностей',{exact:true}).selectOption('history');await filter('Z-1');await page.getByRole('button',{name:'Раскрыть Z-1',exact:true}).click();assert.equal(await page.locator('.related-row').count(),200);
 const more=page.getByRole('button',{name:'Показать ещё',exact:true});await more.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.related-row').count(),201);assert.equal(await more.count(),0);
 await page.locator('.timeline-scroll').scrollIntoViewIfNeeded();await scroll(250,100000);assert.ok(await page.locator('.timeline-scroll').evaluate(e=>e.scrollTop>0));await shot('06-pagination-bottom');
 checks.push('Порция 200/201 доступна с клавиатуры; последний путь виден без дублей, вертикальная прокрутка работает');
 await upload('old');assert.equal(await page.locator('.epic-row').count(),1);assert.equal(await page.locator('.related-row').count(),0);assert.match(await page.locator('body').textContent(),/Данные о связях не загружены/);await shot('07-old-workbook');
 assert.equal((await (await page.request.get('http://127.0.0.1:4336/api/test/state')).json()).jiraCalls,0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 checks.push('Старая книга загружается без дополнения; за весь сценарий вызовов Jira и внешних запросов нет');
 await writeFile(path.join(out,'browser-report.json'),JSON.stringify({status:'passed',browser:'Google Chrome',viewports:['1440x1050','800x1000'],checks,errors,external},null,2)+'\n');console.log(JSON.stringify({status:'passed',checks:checks.length}));
}catch(error){await shot('failure');await writeFile(path.join(out,'browser-failure.json'),JSON.stringify({status:'failed',checks,errors,error:String(error)},null,2)+'\n');console.error(error);process.exitCode=1;}
finally{await browser.close();}
