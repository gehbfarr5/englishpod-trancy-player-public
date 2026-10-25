import assert from 'node:assert/strict';
import test from 'node:test';
import { WechatCloudAdapter } from '../adapters/wechat/cloud';

test('WeChat runtime and rebuilt page share one source across view switches and page reentry',async()=>{
 const handlers:Record<string,()=>void>={};const calls:string[]=[];
 const manager:any={src:'',currentTime:0,duration:100,paused:true,startTime:0,
  play(){calls.push('play');this.paused=false;},pause(){calls.push('pause');this.paused=true;},
  seek(n:number){calls.push(`seek:${n}`);this.currentTime=n;}};
 for(const key of ['Canplay','TimeUpdate','Play','Pause','Ended','Error','Stop'])manager[`on${key}`]=(fn:()=>void)=>{handlers[key]=fn;};
 let definition:any;
 (globalThis as any).wx={getStorageSync:()=>undefined,setStorageSync:()=>{},getBackgroundAudioManager:()=>manager,
  getAccountInfoSync:()=>({miniProgram:{envVersion:'develop'}})};
 (globalThis as any).Page=(value:any)=>{definition=value;};
 const oldIndex=WechatCloudAdapter.prototype.getLessonIndex,oldDetail=WechatCloudAdapter.prototype.getLessonDetail,
  oldResolve=WechatCloudAdapter.prototype.resolveAudioFileId;
 WechatCloudAdapter.prototype.getLessonIndex=async()=>[{lessonId:'0001',title:'Test'}, {lessonId:'0002',title:'Business English'}] as any;
 WechatCloudAdapter.prototype.getLessonDetail=async()=>({title:'Test',audio:{pb:'pb.mp3'},tracks:{pb:[
  {id:0,text:'First sentence',speaker:'M',start:3,end:10,isSection:false},
  {id:1,text:'Second sentence',speaker:'E',start:10,end:20,isSection:false}
 ],dg:[]},vocabulary:[]}) as any;
 WechatCloudAdapter.prototype.resolveAudioFileId=(_id,track)=>{assert.equal(track,'pb');return 'https://example.org/pb.mp3';};
 try {
  const {getPodcastRuntime}=await import('./wechatPodcastRuntime');
  const runtime=await getPodcastRuntime();assert.equal(await getPodcastRuntime(),runtime);
  assert.equal(manager.src,''); // Cold creation never starts sound.
  await import('../pages/rebuildPlayer/index');
  const makePage=()=>Object.assign({},definition,{data:{...definition.data},setData(patch:any){Object.assign(this.data,patch);}});
  const page=makePage();await page.onLoad();
  page.onSearch({detail:{value:'business'}});assert.equal(page.data.courses.length,1);assert.equal(page.data.courses[0].id,'0002');
  page.onSearch({detail:{value:''}});assert.equal(page.data.courses.length,2);
  await runtime.session.open('0001');handlers.Canplay();assert.equal(manager.src,'https://example.org/pb.mp3');
  assert.equal(manager.paused,false);manager.currentTime=12;handlers.TimeUpdate();
  assert.equal(page.data.activeSegment,1);
  await Promise.resolve();assert.equal(page.data.detail.tracks.pb.length,2);
  page.onTranscriptTap({detail:{start:3}});assert.equal(manager.currentTime,3);assert.equal(manager.paused,false);
  const before=calls.length;
  for(const key of ['dg','vocab','pb'])page.onView({currentTarget:{dataset:{key}}});
  assert.equal(calls.length,before);assert.equal(manager.currentTime,3);
  page.onUnload();assert.equal(manager.paused,false);
  const next=makePage();await next.onLoad();next.onShow();assert.equal(next.data.position,3);
  assert.equal(calls.length,before);next.onUnload();
 }finally{WechatCloudAdapter.prototype.getLessonIndex=oldIndex;WechatCloudAdapter.prototype.getLessonDetail=oldDetail;WechatCloudAdapter.prototype.resolveAudioFileId=oldResolve;}
});
