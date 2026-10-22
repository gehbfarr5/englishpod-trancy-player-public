// Exercises the production main.dart entry. Local CI uses generated WAV;
// --url uses real deployed media without intercepting requests or user storage.
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
function wav(){
  const n=8000*120,b=Buffer.alloc(44+n*2);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);
  b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);
  b.write('data',36);b.writeUInt32LE(n*2,40);
  for(let i=0;i<n;i++)b.writeInt16LE(Math.round(100*Math.sin(i*.1)),44+i*2);
  return b;
}
(async()=>{
  const remote=process.argv[2]==='--url';
  const url=remote?process.argv[3]:'http://127.0.0.1:18767/';
  const expected=remote?process.argv[4]:null;
  let refined=!remote||process.argv.includes('--expect-refined-controls');
  let v13=!remote||process.argv.includes('--expect-immersive-v13');
  let v14=!remote||process.argv.includes('--expect-immersive-v14');
  const server=remote?null:spawn('python3',['-m','http.server','18767','--bind','127.0.0.1','--directory',process.argv[2]],{stdio:'ignore'});
  let browser,page;
  try{
    // Read-only public checks can run before this PR deploys. Build 7 introduces
    // v1.3; exact-SHA deployment checks also require it explicitly.
    for(let i=0;;i++){try{const r=await fetch(new URL('build-info.json',url));assert.equal(r.status,200);const info=await r.json();if(expected)assert.equal(info.source_sha,expected);if(Number(info.build)>=8)v14=true;if(Number(info.build)>=7||v14)v13=true;if(v13)refined=true;console.log('BUILD_IDENTITY '+JSON.stringify(info));break;}catch(e){if(i>40)throw e;await new Promise(r=>setTimeout(r,100));}}
    browser=await chromium.launch({headless:true});
    for(const theme of ['dark','light']){
      const context=await browser.newContext({locale:'en-US',colorScheme:theme,viewport:{width:1256,height:706}});
      page=await context.newPage();const errors=[];let requests=0;
      page.on('pageerror',e=>errors.push(e.message));
      page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/audio/'))requests++;});
      let loadDelay=0;
      if(!remote)await page.route('**/audio/**',async r=>{
        if(loadDelay)await new Promise(resolve=>setTimeout(resolve,loadDelay));
        await r.fulfill({status:200,contentType:'audio/wav',body:wav()});
      });
      await page.addInitScript(()=>{
        window.acceptanceMedia=[];window.acceptanceLoads=0;
        window.acceptanceLoadTimings=[];window.acceptancePlayTimings=[];
        window.acceptanceLoadingToastSeen=false;
        new MutationObserver(()=>{
          if(document.body?.textContent.includes('Loading audio…'))window.acceptanceLoadingToastSeen=true;
        }).observe(document,{childList:true,subtree:true,characterData:true});
        const load=HTMLMediaElement.prototype.load;
        HTMLMediaElement.prototype.load=function(...args){
          window.acceptanceLoads++;
          const path=new URL(this.src||'/',location.href).pathname;
          if(path.startsWith('/audio/')){
            const started=performance.now(),row={path,ordinal:window.acceptanceLoadTimings.length+1};
            window.acceptanceLoadTimings.push(row);
            this.addEventListener('loadedmetadata',()=>{row.metadataMs=Math.round(performance.now()-started);},{once:true});
            this.addEventListener('canplay',()=>{row.canplayMs=Math.round(performance.now()-started);},{once:true});
          }
          return load.apply(this,args);
        };
        const play=HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play=function(...args){
          if(!window.acceptanceMedia.includes(this))window.acceptanceMedia.push(this);
          if(this.paused){
            const started=performance.now(),row={path:new URL(this.src||'/',location.href).pathname};
            window.acceptancePlayTimings.push(row);
            this.addEventListener('playing',()=>{row.playingMs=Math.round(performance.now()-started);},{once:true});
          }
          return play.apply(this,args);
        };
      });
      await page.goto(url);await page.waitForFunction(()=>window.englishpodBootComplete===true,null,{timeout:60000});
      const resume=page.getByLabel(/Continue listening · Podcast/).first();
      await resume.waitFor({timeout:60000});
      // Allow the original 2-second brand splash to finish; actual UI determines readiness.
      await page.waitForTimeout(2200);
      if(refined)await page.getByRole('button',{name:'Change appearance',exact:true}).waitFor();
      console.log(`WEB_SCREEN_${theme}_library `+(await page.screenshot()).toString('base64'));
      const wake=async()=>{const reveal=page.getByRole('button',{name:'Show player controls',exact:true}).first();if(await reveal.count())await reveal.click({force:true});};
      const more=async()=>{await wake();await page.getByRole('button',{name:'More',exact:true}).first().click({force:true});};
      const closeMore=async()=>{await page.keyboard.press('Escape');await page.waitForTimeout(200);};
      if(v13)assert.equal(await page.evaluate(()=>window.acceptanceMedia.some(a=>!a.paused)),false,'Homepage emitted audio');
      if(v13)await page.getByLabel(/Open lesson 0001 · Podcast/).first().click({force:true});else await resume.click({force:true});
      const play=page.getByRole('button',{name:'Play',exact:true}).first();
      if(v13)await page.getByRole('button',{name:'Pause',exact:true}).first().waitFor({timeout:30000});else await play.waitFor({timeout:30000});
      if(refined)assert.equal(await page.getByRole('button',{name:'Change appearance',exact:true}).count(),0,'Appearance control leaked into player');
      if(!v13)await play.click({force:true});
      await page.waitForFunction(()=>window.acceptanceMedia.some(a=>!a.paused&&a.currentTime>.5),null,{timeout:30000});
      const count=await page.evaluate(()=>({loads:window.acceptanceLoads,players:window.acceptanceMedia.length,src:window.acceptanceMedia.find(a=>!a.paused).currentSrc}));
      if(v14){
        const unchanged=async()=>assert.deepEqual(await page.evaluate(()=>({loads:window.acceptanceLoads,players:window.acceptanceMedia.length,src:window.acceptanceMedia.find(a=>!a.paused).currentSrc})),count,'Layout changed audio source');
        const wideControls=async()=>{
          assert.equal(await page.getByRole('button',{name:'More',exact:true}).count(),0);
          assert.equal(await page.getByLabel('Immersive mode',{exact:true}).count(),0);
          assert.equal(await page.getByRole('button',{name:'Show player controls',exact:true}).count(),0);
          for(const name of ['Sentence loop','Track loop','Auto-next Podcast'])await page.getByLabel(name,{exact:true}).waitFor();
          const rects=await Promise.all(['Previous sentence','Previous lesson','Next lesson','Next sentence'].map(name=>page.getByRole('button',{name,exact:true}).boundingBox()));
          assert(rects.every(r=>r&&r.x>=980&&Math.abs(r.y-rects[0].y)<2),'Sidebar navigation missing or misaligned');
        };
        await page.waitForTimeout(5100);await wideControls();await unchanged();
        console.log(`WEB_SCREEN_${theme}_wide_sidebar `+(await page.screenshot()).toString('base64'));
        await page.getByRole('button',{name:'Pause',exact:true}).click({force:true});
        await page.waitForTimeout(5100);await wideControls();
        await page.getByRole('button',{name:'Play',exact:true}).click({force:true});
        await page.setViewportSize({width:773,height:601});
        await more();assert.equal(await page.getByLabel('Immersive mode',{exact:true}).getAttribute('aria-checked'),'true');await closeMore();
        const reveal=page.getByRole('button',{name:'Show player controls',exact:true});
        await reveal.waitFor({timeout:10000});
        assert.equal(await page.getByRole('button',{name:'More',exact:true}).count(),0,'More visible in immersion');
        assert.equal(await page.getByRole('button',{name:'Library',exact:true}).count(),0);
        await unchanged();
        console.log(`WEB_SCREEN_${theme}_compact_hidden `+(await page.screenshot()).toString('base64'));
        const pause=page.getByRole('button',{name:'Pause',exact:true}),r=await pause.boundingBox();
        await page.evaluate(()=>{
          window.acceptanceHeroPress={};
          document.addEventListener('pointerdown',e=>{window.acceptanceHeroPress.down=e.timeStamp;},{once:true,capture:true});
          document.addEventListener('pointerup',e=>{window.acceptanceHeroPress.up=e.timeStamp;},{once:true,capture:true});
        });
        // One browser action stays below the 150ms tap/hold threshold. An awaited
        // host round-trip while the pointer is down can accidentally become a hold.
        // Pressed geometry/long-hold behavior is covered by widget regressions.
        await pause.click({force:true});
        const pressMs=await page.evaluate(()=>window.acceptanceHeroPress.up-window.acceptanceHeroPress.down);
        assert(pressMs>=0&&pressMs<150,'Short-tap acceptance exceeded hold threshold');
        console.log(`SHORT_TAP ${theme} ${pressMs.toFixed(1)}ms`);
        await page.getByRole('button',{name:'Play',exact:true}).waitFor();
        assert.deepEqual(await page.getByRole('button',{name:'Play',exact:true}).boundingBox(),r,'Hero moved when paused controls returned');
        await page.waitForTimeout(5100);
        assert.equal(await reveal.count(),0,'Paused player entered immersion');
        await page.getByRole('button',{name:'Library',exact:true}).waitFor();
        await page.getByRole('button',{name:'More',exact:true}).waitFor();
        console.log(`WEB_SCREEN_${theme}_compact_paused `+(await page.screenshot()).toString('base64'));
        await page.getByRole('button',{name:'Play',exact:true}).click({force:true});await reveal.waitFor({timeout:10000});
        const pos=await page.evaluate(()=>window.acceptanceMedia.at(-1).currentTime);
        await page.mouse.click(200,250);await page.getByRole('button',{name:'Library',exact:true}).waitFor();
        const delta=await page.evaluate(()=>window.acceptanceMedia.at(-1).currentTime)-pos;
        assert(delta>=0&&delta<1.5,'Reveal gesture sought a sentence');
        await more();
        const nav=await Promise.all(['Previous sentence','Previous lesson','Next lesson','Next sentence'].map(name=>page.getByRole('button',{name,exact:true}).boundingBox()));
        assert(nav.every(r=>r&&Math.abs(r.y-nav[0].y)<2),'Compact More navigation is not one row');
        console.log(`WEB_SCREEN_${theme}_compact_more `+(await page.screenshot()).toString('base64'));
        await page.getByLabel('Immersive mode',{exact:true}).click({force:true});await closeMore();
        await page.waitForTimeout(5100);assert.equal(await reveal.count(),0,'Disabled immersive preference ignored');
        console.log(`WEB_SCREEN_${theme}_compact_standard `+(await page.screenshot()).toString('base64'));
        await more();await page.getByLabel('Immersive mode',{exact:true}).click({force:true});await closeMore();
        await page.setViewportSize({width:1256,height:706});await page.waitForTimeout(5100);await wideControls();await unchanged();
        console.log(`PASS E16 S13 S14 S15 S17 S20 S21 ${theme}; wide sidebar only, compact pause reveals and stays visible, hidden More absent, preference survives resize`);
      }else{
      if(v13){await page.getByLabel('Immersive mode',{exact:true}).first().click({force:true});console.log(`PASS E09 E16 ${theme}; direct course entry starts playback, fresh immersive default`);}
      for(const mode of ['standard','immersive']){
        if(mode==='immersive'){
          await page.getByLabel('Immersive mode',{exact:true}).click({force:true});
        }
        for(const [width,height] of [[1256,706],[773,601]]){
          const before=await page.evaluate(()=>window.acceptanceMedia.find(a=>!a.paused).currentTime);
          await page.setViewportSize({width,height});
          await page.getByRole('button',{name:'More',exact:true}).first().waitFor();
          await page.waitForFunction(t=>window.acceptanceMedia.some(a=>!a.paused&&a.currentTime>t),before);
          assert.deepEqual(await page.evaluate(()=>({loads:window.acceptanceLoads,players:window.acceptanceMedia.length,src:window.acceptanceMedia.find(a=>!a.paused).currentSrc})),count,'Layout changed audio source');
          if(v13&&mode==='immersive'){
            await page.getByRole('button',{name:'Show player controls',exact:true}).first().waitFor({timeout:10000});
            const corners=[{x:0,y:0,width:8,height:8},{x:width-8,y:0,width:8,height:8},{x:width-8,y:height/2,width:8,height:8}];
            const beforePixels=await Promise.all(corners.map(clip=>page.screenshot({clip})));
            const pause=page.getByRole('button',{name:'Pause',exact:true}).first(),r=await pause.boundingBox();
            await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();
            const pressedShot=page.screenshot({clip:corners[0]});
            await page.waitForTimeout(40);await page.mouse.up();
            const pressedPixels=await pressedShot;
            await page.getByRole('button',{name:'Play',exact:true}).first().waitFor();
            const afterPixels=await Promise.all(corners.map(clip=>page.screenshot({clip})));
            assert(beforePixels[0].equals(pressedPixels),'Viewport edge changed on press');
            beforePixels.forEach((pixels,i)=>assert(pixels.equals(afterPixels[i]),'Viewport edge changed on pause'));
            assert.equal(await page.getByRole('button',{name:'Library',exact:true}).count(),0,'Hero woke chrome');
            const position=await page.evaluate(()=>window.acceptanceMedia.at(-1).currentTime);
            console.log(`WEB_SCREEN_${theme}_immersive_hidden_${width} `+(await page.screenshot()).toString('base64'));
            await page.mouse.click(200,250);await page.getByRole('button',{name:'Library',exact:true}).first().waitFor();
            assert(Math.abs(await page.evaluate(()=>window.acceptanceMedia.at(-1).currentTime)-position)<.3,'Reveal gesture sought a sentence');
            await page.getByRole('button',{name:'Play',exact:true}).first().click({force:true});
            if(width===773){
              assert.equal(await page.getByRole('button',{name:'Previous sentence',exact:true}).count(),0,'Crowded footer sentence button');
              await more();
              const rects=await Promise.all(['Previous sentence','Previous lesson','Next lesson','Next sentence'].map(name=>page.getByRole('button',{name,exact:true}).last().boundingBox()));
              assert(rects.every(r=>r&&Math.abs(r.y-rects[0].y)<2),'More navigation is not one row');
              console.log(`WEB_SCREEN_${theme}_more_${width} `+(await page.screenshot()).toString('base64'));
              await closeMore();
            }
            console.log(`PASS S13 S14 S15 S17 ${theme} ${width}x${height}; full hidden layout, stable edge pixels, reveal consumes tap, compact menu`);
          }
          console.log(`WEB_SCREEN_${theme}_${mode}_${width} `+(await page.screenshot()).toString('base64'));
          console.log(`PASS S09 ${theme} ${mode} ${width}x${height}; media advances without reload`);
        }
        // Return wide so the original themed options remain directly reachable.
        await page.setViewportSize({width:1256,height:706});if(v13)await wake();await page.mouse.move(200,250);
      }
      }
      if(v13)await wake();
      await page.mouse.move(400,350);await page.mouse.wheel(0,500);
      await page.getByRole('button',{name:/Manual transcript reading\. Current sentence/}).waitFor();
      await page.setViewportSize({width:773,height:601});
      await page.getByRole('button',{name:/Manual transcript reading\. Current sentence/}).waitFor();
      assert.deepEqual(await page.evaluate(()=>({loads:window.acceptanceLoads,players:window.acceptanceMedia.length,src:window.acceptanceMedia.find(a=>!a.paused).currentSrc})),count,'Manual reading resize reloaded media');
      const pbPosition=await page.evaluate(()=>window.acceptanceMedia.find(a=>!a.paused).currentTime);
      await page.getByRole('button',{name:'Pause',exact:true}).first().click({force:true});
      await page.waitForFunction(()=>window.acceptanceMedia.every(a=>a.paused));
      if(v13)await wake();else await page.mouse.move(8,70); // Wake before navigating tabs.
      await page.getByRole('button',{name:'Dialogue',exact:true}).first().click({force:true});
      await page.getByRole('button',{name:'Play',exact:true}).first().waitFor();
      await page.getByRole('button',{name:'Play',exact:true}).first().click({force:true});
      await page.waitForFunction(()=>window.acceptanceMedia.some(a=>!a.paused&&a.currentTime>.2));
      await page.getByRole('button',{name:'Pause',exact:true}).first().click({force:true});
      await page.waitForFunction(()=>window.acceptanceMedia.every(a=>a.paused));
      if(v13)await wake();else await page.mouse.move(8,70); // Wake before navigating tabs.
      await page.getByRole('button',{name:'Podcast',exact:true}).first().click({force:true});
      await page.getByRole('button',{name:'Play',exact:true}).first().click({force:true});
      await page.waitForFunction(t=>window.acceptanceMedia.some(a=>!a.paused&&a.currentTime>=t-.3),pbPosition);
      if(v13)await wake();else await page.mouse.move(8,70); // Wake before navigating tabs.
      await page.getByRole('button',{name:'Vocab',exact:true}).first().click({force:true});
      assert.equal(await page.evaluate(()=>window.acceptanceMedia.some(a=>!a.paused)),true,'Vocab paused audio');
      console.log('AUDIO_LOAD_METRICS '+JSON.stringify({theme,media:remote?'real MP3':'generated WAV',
        ...await page.evaluate(()=>({loads:window.acceptanceLoadTimings,play:window.acceptancePlayTimings}))}));
      if(refined)assert.equal(await page.evaluate(()=>window.acceptanceLoadingToastSeen),false,'Loading toast appeared');
      if(v13){
        await more();
        await page.getByLabel('Track loop',{exact:true}).last().click({force:true});
        await page.getByLabel('Auto-next Podcast',{exact:true}).last().click({force:true});
        await page.getByLabel('Immersive mode',{exact:true}).last().click({force:true});
        await page.waitForFunction(()=>{let x=JSON.parse(localStorage.getItem('flutter.ep_web_learning_v2')||'null');if(typeof x==='string')x=JSON.parse(x);return x&&x.trackLoop===true&&x.sentenceLoop===false&&x.autoNext===false&&x.immersive===false;});
        await closeMore();
      }
      await page.reload();await resume.waitFor({timeout:60000});
      assert.equal(await page.evaluate(()=>window.acceptanceMedia.some(a=>!a.paused)),false,'Restart emitted audio');
      if(refined)await page.getByRole('button',{name:'Change appearance',exact:true}).waitFor();
      if(v13){
        await page.waitForTimeout(2200);await resume.click({force:true});
        await page.getByRole('button',{name:'Pause',exact:true}).first().waitFor({timeout:30000});
        await more();
        assert.equal(await page.getByLabel('Immersive mode',{exact:true}).last().getAttribute('aria-checked'),'false');
        assert.equal(await page.getByLabel('Track loop',{exact:true}).last().getAttribute('aria-checked'),'true');
        assert.equal(await page.getByLabel('Auto-next Podcast',{exact:true}).last().getAttribute('aria-checked'),'false');
        await closeMore();
        console.log(`PASS S16 S19 ${theme}; reload restores all persisted switches, entry resumes playback`);
      }
      if(!remote){
        // Synthetic delay is a UI regression check, excluded from real-MP3 metrics above.
        await page.waitForTimeout(2200);
        if(v13){await page.getByRole('button',{name:'Pause',exact:true}).first().click({force:true});}else await resume.click({force:true});
        await page.getByRole('button',{name:'Play',exact:true}).first().waitFor();
        await page.mouse.move(8,70);
        loadDelay=2400;
        await page.getByRole('button',{name:'Dialogue',exact:true}).first().click({force:true});
        const busyPlay=page.getByRole('button',{name:'Play · Loading audio',exact:true});
        await busyPlay.waitFor({timeout:10000});
        assert.equal(await page.getByText('Loading audio…',{exact:true}).count(),0);
        console.log(`WEB_SCREEN_${theme}_loading_773 `+(await page.screenshot()).toString('base64'));
        await busyPlay.click({force:true});
        await page.getByRole('button',{name:'Pause · Loading audio',exact:true}).click({force:true});
        await page.getByRole('button',{name:'Play',exact:true}).first().waitFor({timeout:10000});
        assert.equal(await page.evaluate(()=>window.acceptanceMedia.some(a=>!a.paused)),false,'Pause during loading was lost');
        assert.equal(await page.evaluate(()=>window.acceptanceLoadingToastSeen),false);
        console.log(`PASS refined controls ${theme}; home-only appearance, delayed hero loading, latest pause; injected 2400ms not a network measurement`);
      }
      assert.deepEqual(errors,[]);
      console.log(`PASS E07 E12 S09 S10 S11 ${theme}; requests=${requests}; ${remote?'real deployed MP3':'generated WAV'}; Tesla hardware NOT TESTED`);
      await context.close();
    }
  }catch(e){
    if(page){console.error('WEB_DOM '+(await page.locator('body').innerHTML()).slice(-18000));console.log('WEB_SCREEN_FAILURE '+(await page.screenshot()).toString('base64'));}
    throw e;
  }finally{if(browser)await browser.close();server?.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});

