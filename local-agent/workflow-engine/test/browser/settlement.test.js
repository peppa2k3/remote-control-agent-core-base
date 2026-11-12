const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');

test('real content script reports busy until a cancelled action settles',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage();await page.setContent('<main id="fixture">Fixture only</main>');
    await page.evaluate(()=>{window.chrome={runtime:{onMessage:{addListener(fn){window.fixtureListener=fn;}},async sendMessage(){return {ok:true};}}};});
    await page.addScriptTag({path:path.resolve(__dirname,'../../../chrome-reels-extension/content.js')});
    const busy=await page.evaluate(()=>{
      window.fixtureResponse=new Promise(resolve=>window.fixtureListener({type:'execute',runId:'fixture',step:{action:'waitFor',selector:'#not-yet',timeoutMs:5000}},null,resolve));
      let state;window.fixtureListener({type:'actionStatus'},null,v=>state=v);return state.busy;
    });assert.equal(busy,true);
    await page.evaluate(()=>window.fixtureListener({type:'cancel',runId:'fixture'},null,()=>{}));
    const response=await page.evaluate(()=>window.fixtureResponse);assert.equal(response.ok,false);
    await page.waitForFunction(()=>{let state;window.fixtureListener({type:'actionStatus'},null,v=>state=v);return state.busy===false;});
  }finally{await browser.close();}
});
